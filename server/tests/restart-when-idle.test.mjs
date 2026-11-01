import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { authenticationFixture } from "../../tests/helpers/auth.mjs";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer } from "ws";

async function waitFor(read) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await read();
    if (result) return result;
    await delay(25);
  }
  assert.fail("等待重启检查结果超时");
}

async function watcher(t, state, fail = false) {
  const directory = await mkdtemp(join(tmpdir(), "codex-web-idle-restart-"));
  const auth = await authenticationFixture(directory);
  const record = join(directory, "restart.json");
  await writeFile(
    join(directory, "systemctl"),
    `#!${process.execPath}\nimport {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2))); process.exit(${fail ? 1 : 0});\n`,
    { mode: 0o755 },
  );
  let healthChecks = 0;
  const server = https.createServer(auth.tls, (request, response) => {
    assert.equal(request.url, "/healthz");
    healthChecks++;
    response.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        ready: healthChecks > 1,
        version: { displayVersion: "fixture-updated" },
      }),
    );
  });
  const sockets = new WebSocketServer({ server });
  const requests = [];
  sockets.on("connection", (socket, request) => {
    assert.equal(request.url, "/maintenance");
    assert.equal(
      request.headers.authorization,
      "Bearer fixture-maintenance-token",
    );
    socket.on("message", (bytes) => requests.push(JSON.parse(bytes)));
    socket.send(JSON.stringify({ method: "lan/state", params: state }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL("../../scripts/restart-when-idle.mjs", import.meta.url),
      ),
    ],
    {
      env: {
        ...process.env,
        PORT: String(server.address().port),
        CODEX_HOME: directory,
        PATH: directory + ":" + process.env.PATH,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  child.stdout.on("data", (bytes) => (log += bytes));
  child.stderr.on("data", (bytes) => (log += bytes));
  const exited = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    for (const socket of sockets.clients) socket.terminate();
    await new Promise((resolve) => sockets.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  await waitFor(() => log.includes("等待空闲"));
  return {
    requests,
    log: () => log,
    healthChecks: () => healthChecks,
    restarted: () =>
      readFile(record, "utf8")
        .then(JSON.parse)
        .catch(() => null),
    exited,
    emit(method, params) {
      for (const socket of sockets.clients)
        socket.send(JSON.stringify({ method, params }));
    },
  };
}

const idle = {
  ready: true,
  activeTurns: {},
  compactions: {},
  terminals: { "open-shell": { running: true } },
};

test("网页终端保持打开时执行重启，健康检查就绪后报告实际版本", async (t) => {
  const app = await watcher(t, idle);
  const output = setInterval(() => {
    app.emit("lan/terminalStarted", { processId: "another-shell" });
    app.emit("command/exec/outputDelta", {
      processId: "open-shell",
      deltaBase64: "",
    });
  }, 50);
  t.after(() => clearInterval(output));
  assert.deepEqual(await waitFor(app.restarted), [
    "--user",
    "restart",
    "codex-lan-web.service",
  ]);
  assert.deepEqual(await app.exited, [0, null]);
  assert.equal(app.healthChecks(), 2, "健康接口未就绪时继续验证");
  assert.match(app.log(), /通过健康检查，运行版本：fixture-updated/);
  assert.deepEqual(app.requests, [], "等待程序不向终端或任务发送停止请求");
});

test("连接未就绪时等待，连接恢复后才重启", async (t) => {
  const app = await watcher(t, { ...idle, ready: false });
  await delay(2200);
  assert.equal(await app.restarted(), null);
  app.emit("lan/state", idle);
  await waitFor(app.restarted);
  assert.deepEqual(await app.exited, [0, null]);
});

test("实际轮次和提交阶段整理分别阻止重启，结束后保留打开的终端并重启", async (t) => {
  const app = await watcher(t, {
    ...idle,
    activeTurns: { thread: "turn" },
    compactions: { thread: { id: "compact", status: "starting" } },
  });
  await delay(2200);
  assert.equal(await app.restarted(), null);
  app.emit("turn/completed", { threadId: "thread", turn: { id: "turn" } });
  await waitFor(() => app.log().includes("0 个任务，1 个上下文整理"));
  await delay(2200);
  assert.equal(await app.restarted(), null);
  app.emit("lan/compaction", {
    threadId: "thread",
    compaction: { id: "compact", status: "completed" },
  });
  await waitFor(app.restarted);
  assert.deepEqual(await app.exited, [0, null]);
  assert.deepEqual(app.requests, []);
});

test("空闲等待期间新轮次取消重启，旧轮次结束不会解除新轮次占用", async (t) => {
  const app = await watcher(t, idle);
  app.emit("turn/started", { threadId: "thread", turn: { id: "new" } });
  app.emit("turn/completed", { threadId: "thread", turn: { id: "old" } });
  await delay(2200);
  assert.equal(await app.restarted(), null);
  app.emit("turn/completed", { threadId: "thread", turn: { id: "new" } });
  await waitFor(app.restarted);
  assert.deepEqual(await app.exited, [0, null]);
});

test("重启失败时返回失败状态并保留错误日志", async (t) => {
  const app = await watcher(t, idle, true);
  assert.deepEqual(await app.exited, [1, null]);
  assert.match(app.log(), /Command failed/);
  assert.equal(app.healthChecks(), 0);
  assert(!app.log().includes("通过健康检查"));
});
