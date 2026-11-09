import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer } from "ws";
import { referenceToolParams } from "../../server/src/backends/codex/reference-tools.mjs";

const directory = await mkdtemp(join(tmpdir(), "claudex-reference-native-"));
const home = join(directory, "home");
await mkdir(home);
await writeFile(join(home, "config.toml"), 'model = "gpt-5.4"\n');
const source = new WebSocketServer({ port: 0, host: "127.0.0.1" });
await new Promise((resolve) => source.once("listening", resolve));
const queries = [];
let fixtureHistory = false;
source.on("connection", (socket) =>
  socket.on("message", async (raw) => {
    const request = JSON.parse(raw);
    if (request.id === undefined) return;
    queries.push(request);
    try {
      let result;
      if (request.method === "initialize") {
        assert.equal(typeof request.params.clientInfo.version, "string");
        result = {};
      } else if (fixtureHistory && request.method === "thread/read")
        result = {
          thread: { id: "fixture-reference", name: "隔离引用", cwd: directory },
        };
      else if (fixtureHistory && request.method === "thread/turns/list")
        result = {
          data: [
            {
              id: "saved-turn",
              status: "completed",
              items: [
                {
                  type: "userMessage",
                  content: [{ type: "text", text: "测试问题" }],
                },
                { type: "agentMessage", text: "测试回答" },
              ],
            },
          ],
          nextCursor: null,
        };
      else result = await call(request.method, request.params);
      socket.send(JSON.stringify({ id: request.id, result }));
    } catch (error) {
      socket.send(
        JSON.stringify({
          id: request.id,
          error: { code: -32000, message: error.message },
        }),
      );
    }
  }),
);
const executable = process.env.CODEX_EXECUTABLE || "codex";
const version = execFileSync(executable, ["--version"], {
  encoding: "utf8",
}).trim();
const child = spawn(executable, ["app-server", "--listen", "stdio://"], {
  env: { ...process.env, CODEX_HOME: home },
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
const pending = new Map();
let sequence = 1;
const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
function call(method, params) {
  const id = sequence++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(method + " 超时\\n" + stderr));
    }, 20000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
try {
  await call("initialize", {
    clientInfo: { name: "reference_validation", version: "1" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  const { thread } = await call(
    "thread/start",
    referenceToolParams(
      "thread/start",
      {
        cwd: directory,
        ephemeral: false,
        approvalPolicy: "never",
        sandbox: "danger-full-access",
      },
      { upstreamUrl: `ws://127.0.0.1:${source.address().port}` },
    ),
  );
  let registered = false;
  for (let index = 0; index < 60; index++) {
    const status = await call("mcpServerStatus/list", { threadId: thread.id });
    registered = status.data.some(
      (server) =>
        server.name === "claudex_references" && server.tools?.read_thread,
    );
    if (registered) break;
    await delay(200);
  }
  assert(registered, "真实 CLI 必须注册 read_thread");
  const result = await call("mcpServer/tool/call", {
    threadId: thread.id,
    server: "claudex_references",
    tool: "read_thread",
    arguments: { threadId: thread.id, turnLimit: 10 },
  });
  await writeFile(join(directory, "result.json"), JSON.stringify(result));
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /thread\/turns\/list.*unavailable/);
  fixtureHistory = true;
  const populated = await call("mcpServer/tool/call", {
    threadId: thread.id,
    server: "claudex_references",
    tool: "read_thread",
    arguments: { threadId: "fixture-reference", turnLimit: 10 },
  });
  assert.match(JSON.stringify(populated), /测试回答/);
  assert(
    queries.some(
      (request) =>
        request.method === "thread/turns/list" &&
        request.params.threadId === "fixture-reference",
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      version,
      modelCalls: 0,
      validation:
        "真实 CLI 的 MCP 注册与调用、原生未持久化会话错误透传；非空历史采用隔离模拟数据",
    }),
  );
} finally {
  for (const request of pending.values()) clearTimeout(request.timer);
  lines.close();
  child.stdin.end();
  child.kill("SIGTERM");
  for (const socket of source.clients) socket.terminate();
  await new Promise((resolve) => source.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
