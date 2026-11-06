import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { createCodexAdapter } from "../../server/src/backends/codex/adapter.mjs";
import { readConfig } from "../../server/src/config.mjs";

const executable = process.env.CODEX_EXECUTABLE || "codex";
const version = execFileSync(executable, ["--version"], {
  encoding: "utf8",
}).trim();
const root = await mkdtemp(join(tmpdir(), "codex-release-contract-"));
const config = readConfig({
  CODEX_HOME: root,
  CLAUDEX_WEB_CONFIG_DIR: join(root, "web"),
});
const threadId = randomUUID();
const now = new Date().toISOString();
const date = now.slice(0, 10);
const sessions = join(root, "sessions", ...date.split("-"));
await mkdir(sessions, { recursive: true });
// 人工历史只用于原生加载与关闭；整个测试不提交模型轮次。
await writeFile(
  join(sessions, `rollout-${date}T00-00-00-${threadId}.jsonl`),
  [
    {
      type: "session_meta",
      payload: {
        id: threadId,
        timestamp: now,
        cwd: root,
        originator: "codex_cli_rs",
        cli_version: version.split(" ").at(-1),
        source: "cli",
        model_provider: "openai",
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Isolated lifecycle fixture" }],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Fixture completed" }],
      },
    },
  ]
    .map((record) => JSON.stringify({ timestamp: now, ...record }))
    .join("\n") + "\n",
);
const reserve = createServer();
reserve.listen(0, "127.0.0.1");
await once(reserve, "listening");
const upstream = `ws://127.0.0.1:${reserve.address().port}`;
await new Promise((resolve) => reserve.close(resolve));
const child = spawn(executable, ["app-server", "--listen", upstream], {
  env: { ...process.env, CODEX_HOME: root },
  stdio: ["ignore", "ignore", "pipe"],
});
child.stderr.resume();
const events = [];
let adapter;
let sequence = 0;
async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("原生订阅生命周期等待超时");
    if (child.exitCode !== null) throw new Error("隔离 app-server 已退出");
    await delay(5);
  }
}
try {
  // app-server 在监听前输出启动信息；使用独立短连接确认监听，不提交协议请求。
  let listening = false;
  for (let i = 0; i < 200 && !listening; i++) {
    listening = await new Promise((resolve) => {
      const socket = new WebSocket(upstream);
      socket.once("open", () => {
        socket.close();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (!listening) await delay(10);
  }
  assert.ok(listening);
  adapter = createCodexAdapter({
    backend: { url: upstream, dataDir: root },
    config,
    version: { displayVersion: "lifecycle-contract" },
    send: (client, message) => client.deliver(message),
    broadcast: (message) => events.push(message),
  });
  await adapter.connect();
  await until(() => adapter.ready);
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      adapter
        .receive(
          {
            readyState: 1,
            deliver: (message) =>
              message.error
                ? reject(new Error(message.error.message))
                : resolve(message.result),
          },
          { id: ++sequence, method, params },
        )
        .catch(reject);
    });
  await call("thread/name/set", { threadId, name: "Lifecycle fixture" });
  for (let cycle = 0; cycle < 8; cycle++) {
    const before = events.length;
    const first = call("thread/resume", { threadId, excludeTurns: true });
    const second = first.then(() =>
      call("thread/resume", { threadId, excludeTurns: true }),
    );
    await second;
    await until(
      () =>
        events
          .slice(before)
          .filter(
            (e) =>
              e.method === "thread/closed" && e.params.threadId === threadId,
          ).length >= 2,
    );
  }
  assert.equal(
    events.some((event) => event.method === "turn/started"),
    false,
  );
  console.log(
    JSON.stringify({
      version,
      nativeAdapter: true,
      immediateReopenCycles: 8,
      modelTurns: 0,
    }),
  );
} finally {
  adapter?.close();
  if (child.exitCode === null) {
    const ended = once(child, "exit");
    child.kill();
    await ended;
  }
  await rm(root, { recursive: true, force: true });
}
