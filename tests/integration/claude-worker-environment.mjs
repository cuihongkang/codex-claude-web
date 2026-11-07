import assert from "node:assert/strict";
import https from "node:https";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  stat,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClaudeWorkerAdapter } from "../../server/src/backends/claude/worker-client.mjs";
import { workerLocation } from "../../server/src/backends/claude/worker-location.mjs";
import { messagesServer } from "../helpers/claude-messages-server.mjs";

const directory = await mkdtemp(join(tmpdir(), "claude-worker-env-"));
const cwd = join(directory, "workspace");
await mkdir(cwd);
const cert = join(directory, "private CA.pem"),
  key = join(directory, "key.pem");
await promisify(execFile)("openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  key,
  "-out",
  cert,
  "-days",
  "1",
  "-subj",
  "/CN=localhost",
  "-addext",
  "subjectAltName=IP:127.0.0.1",
]);
const service = await messagesServer();
const tls = https.createServer(
  { cert: await readFile(cert), key: await readFile(key) },
  (request, response) => {
    const upstream = http.request(
      new URL(request.url, service.url),
      { method: request.method, headers: request.headers },
      (reply) => {
        response.writeHead(reply.statusCode, reply.headers);
        reply.pipe(response);
      },
    );
    upstream.on("error", (error) => response.destroy(error));
    request.pipe(upstream);
  },
);
await new Promise((resolve) => tls.listen(0, "127.0.0.1", resolve));
const url = `https://127.0.0.1:${tls.address().port}`;
await assert.rejects(
  fetch(url + "/v1/messages"),
  "当前进程尚未启动加载隔离CA，TLS应拒绝",
);
const backend = {
  id: "claude",
  type: "claude",
  enabled: true,
  executable: process.env.CLAUDE_EXECUTABLE || "claude",
  dataDir: join(directory, "config space"),
  stateDir: join(directory, "web-state"),
  args: [],
  proxy: { mode: "http", host: "127.0.0.1", port: 9 },
};
const config = {
  configDir: directory,
  claudeHome: join(directory, ".claude"),
  codexHome: directory,
  backendsFile: join(directory, "backends.json"),
  defaultCwd: cwd,
  projectlessRoot: join(directory, "projects"),
};
await writeFile(
  config.backendsFile,
  JSON.stringify({
    version: 1,
    backends: [backend],
    providers: [
      {
        id: "fixture",
        backendId: "claude",
        protocol: "messages",
        name: "Fixture",
        baseUrl: url,
        apiKey: "test-token",
        models: ["fixture-model"],
      },
    ],
  }),
  { mode: 0o600 },
);
const keys = [
  "NODE_EXTRA_CA_CERTS",
  "NODE_USE_ENV_PROXY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
];
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  NODE_EXTRA_CA_CERTS: cert,
  NODE_USE_ENV_PROXY: "1",
  HTTP_PROXY: "http://fixture:private-secret@127.0.0.1:9",
  HTTPS_PROXY: "http://fixture:private-secret@127.0.0.1:9",
  NO_PROXY: "127.0.0.1,localhost",
});
const events = [];
const adapter = createClaudeWorkerAdapter({
  backend,
  config,
  broadcast: (event) => events.push(event),
  send: (client, message) => client.deliver(message),
});
let sequence = 0;
const call = (method, params) =>
  new Promise((resolve, reject) =>
    adapter.receive(
      {
        deliver(message) {
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        },
      },
      { id: ++sequence, method, params },
    ),
  );
async function until(predicate) {
  for (let i = 0; i < 1000; i++) {
    if (await predicate()) return;
    await delay(20);
  }
  throw new Error("隔离TLS供应商轮次超时");
}
try {
  await adapter.connect();
  assert.equal(adapter.ready, true);
  const environment = (
    await readFile(`/proc/${adapter.workerPid}/environ`, "utf8")
  ).split("\0");
  assert.ok(environment.includes(`NODE_EXTRA_CA_CERTS=${cert}`));
  assert.ok(environment.includes("NODE_USE_ENV_PROXY=1"));
  assert.ok(environment.includes("HTTPS_PROXY=http://127.0.0.1:9"));
  assert.ok(environment.includes("https_proxy=http://127.0.0.1:9"));
  assert.ok(environment.includes("NO_PROXY=localhost,127.0.0.1,::1"));
  const paths = (await readdir(backend.stateDir)).filter((path) =>
    path.startsWith("worker-environment-"),
  );
  assert.equal(paths.length, 1);
  assert.equal(
    (await stat(join(backend.stateDir, paths[0]))).mode & 0o777,
    0o600,
  );
  const { stdout } = await promisify(execFile)("systemctl", [
    "--user",
    "show",
    workerLocation(backend).unit,
    "--property=ExecStart",
    "--value",
  ]);
  assert.ok(
    !stdout.includes("private-secret"),
    "代理凭据保留在受限文件，进程argv无明文",
  );
  const { thread } = await call("thread/start", {
    cwd,
    providerId: "fixture",
    model: "fixture-model",
  });
  const { turn } = await call("turn/start", {
    threadId: thread.id,
    input: [{ type: "text", text: "真实校验worker启动CA" }],
  });
  await until(() =>
    events.some(
      (event) =>
        event.method === "turn/completed" && event.params.turn.id === turn.id,
    ),
  );
  const completed = events.find(
    (event) =>
      event.method === "turn/completed" && event.params.turn.id === turn.id,
  ).params.turn;
  assert.equal(completed.status, "completed", JSON.stringify(completed.error));
  assert.ok(service.requests.length > 0);
  await adapter.shutdown();
  adapter.close();
  assert.equal(
    (await readdir(backend.stateDir)).filter((path) =>
      path.startsWith("worker-environment-"),
    ).length,
    0,
  );
  const direct = createClaudeWorkerAdapter({
    backend: { ...backend, proxy: { mode: "off" } },
    config,
    broadcast() {},
    send: (client, message) => client.deliver(message),
  });
  try {
    await direct.connect();
    const environment = (
      await readFile(`/proc/${direct.workerPid}/environ`, "utf8")
    ).split("\0");
    assert.ok(environment.includes("HTTP_PROXY="));
    assert.ok(environment.includes("https_proxy="));
    assert.ok(environment.includes("NODE_USE_ENV_PROXY=0"));
  } finally {
    await direct.shutdown();
    direct.close();
  }
  console.log(
    "Claude worker bootstrap environment passed: Node startup CA and env proxy, HTTPS supplier, paths with spaces, private EnvironmentFile and no credentials in argv",
  );
} finally {
  await adapter.shutdown().catch(() => {});
  adapter.close();
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  tls.closeAllConnections();
  await new Promise((resolve) => tls.close(resolve));
  await service.close();
  await rm(directory, { recursive: true, force: true });
}
