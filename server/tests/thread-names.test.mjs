import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authenticationFixture } from "../../tests/helpers/auth.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import {
  createThreadNaming,
  generateThreadName,
} from "../src/thread-names.mjs";

async function waitFor(read) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (read()) return;
    await delay(5);
  }
  assert.fail("未收到预期的标题更新");
}

async function backend(t, handle) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const requests = [];
  server.on("connection", (socket) => {
    socket.on("message", (bytes) => {
      const request = JSON.parse(bytes);
      requests.push(request);
      handle(request, socket);
    });
  });
  t.after(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  return { url: `ws://127.0.0.1:${server.address().port}`, requests };
}

const respond = (socket, request, result) =>
  socket.send(JSON.stringify({ id: request.id, result }));
const notify = (socket, method, params) =>
  socket.send(JSON.stringify({ method, params }));
const config = {
  model: "fixture-model",
  mcp_servers: { fixture: { enabled: true, command: "fixture-tool" } },
};
const model = {
  model: "fixture-model",
  supportedReasoningEfforts: [
    { reasoningEffort: "low" },
    { reasoningEffort: "high" },
  ],
};

function titleResponse(request, socket) {
  if (request.method === "config/read") respond(socket, request, { config });
  else if (request.method === "model/list")
    respond(socket, request, { data: [model] });
  else if (request.method === "thread/start")
    respond(socket, request, { thread: { id: "title-ephemeral" } });
  else if (request.id !== undefined) respond(socket, request, {});
}

function completeTitle(socket, text, status = "completed") {
  notify(socket, "item/completed", {
    threadId: "title-ephemeral",
    item: {
      id: "title-item",
      type: "agentMessage",
      phase: "final_answer",
      text,
    },
  });
  notify(socket, "turn/completed", {
    threadId: "title-ephemeral",
    turn: { id: "title-turn", status },
  });
}

test("标题生成使用独立的临时会话、标准速度和结构化输出，并清理订阅", async (t) => {
  const app = await backend(t, (request, socket) => {
    // 完成通知先于 turn/start 响应到达时，同样保留最终标题。
    if (request.method === "turn/start")
      completeTitle(
        socket,
        JSON.stringify({ title: "  修复网页\n 对话标题  " }),
      );
    titleResponse(request, socket);
  });
  assert.equal(
    await generateThreadName({
      url: app.url,
      version: "1.0.0",
      text: "请为网页对话增加自动标题。".repeat(1000),
    }),
    "修复网页 对话标题",
  );
  await waitFor(() =>
    app.requests.some((r) => r.method === "thread/unsubscribe"),
  );
  const start = app.requests.find((r) => r.method === "thread/start").params;
  assert.equal(start.ephemeral, true);
  assert.equal(start.model, config.model);
  assert.equal(start.serviceTier, null);
  assert.equal(start.sandbox, "read-only");
  assert.equal(start.config.project_doc_max_bytes, 0);
  assert.equal(start.config.features.shell_tool, false);
  assert.equal(start.config.features.hooks, false);
  assert.deepEqual(start.config.mcp_servers, { fixture: { enabled: false } });
  const turn = app.requests.find((r) => r.method === "turn/start").params;
  assert.equal(turn.effort, "low");
  assert.equal(JSON.parse(turn.input[0].text).text.length, 6000);
  assert.deepEqual(turn.outputSchema.required, ["title"]);
});

for (const failure of [
  "invalid",
  "empty",
  "failed",
  "closed",
  "timeout",
  "abort",
]) {
  test(`标题生成在 ${failure} 时结束并清理连接`, async (t) => {
    const controller = new AbortController();
    const app = await backend(t, (request, socket) => {
      if (request.method === "turn/start") {
        if (failure === "closed") return socket.close();
        if (failure === "abort" || failure === "timeout") {
          notify(socket, "turn/started", {
            threadId: "title-ephemeral",
            turn: { id: "title-turn" },
          });
          respond(socket, request, { turn: { id: "title-turn" } });
          if (failure === "abort") setTimeout(() => controller.abort(), 5);
          return;
        }
        completeTitle(
          socket,
          failure === "invalid"
            ? "invalid JSON"
            : JSON.stringify({ title: " " }),
          failure === "failed" ? "failed" : "completed",
        );
      }
      titleResponse(request, socket);
    });
    await assert.rejects(
      generateThreadName({
        url: app.url,
        version: "1.0.0",
        text: "构造的标题测试消息",
        signal: controller.signal,
        timeout: failure === "timeout" ? 100 : 2000,
      }),
    );
    if (failure === "abort" || failure === "timeout") {
      await waitFor(() =>
        app.requests.some((r) => r.method === "thread/unsubscribe"),
      );
      assert.deepEqual(
        app.requests.find((r) => r.method === "turn/interrupt").params,
        { threadId: "title-ephemeral", turnId: "title-turn" },
      );
    }
  });
}

function namingFixture(generate) {
  const threads = new Map();
  const writes = [],
    errors = [];
  const naming = createThreadNaming({
    async call(method, params) {
      if (method === "thread/read")
        return { thread: { ...threads.get(params.threadId) } };
      writes.push(params);
      threads.get(params.threadId).name = params.name;
      return {};
    },
    generate,
    onError: (error) => errors.push(error),
  });
  const add = (id, extra = {}) => {
    const thread = { id, preview: "请修复网页对话标题", ...extra };
    threads.set(id, thread);
    return thread;
  };
  return { naming, threads, writes, errors, add };
}

test("标题任务按序执行并合并重复请求，使用已保存的首条消息", async () => {
  const generated = [];
  let finish;
  const app = namingFixture((params) => {
    generated.push(params);
    return new Promise((resolve) => (finish = resolve));
  });
  const first = app.add("title-first", {
    model: "fixture-model",
    modelProvider: "fixture-provider",
  });
  const second = app.add("title-second");
  app.naming.schedule(first, { text: "后续消息" });
  app.naming.schedule(first);
  app.naming.schedule(second);
  await waitFor(() => generated.length === 1);
  assert.equal(generated[0].text, first.preview);
  assert.equal(generated[0].model, first.model);
  assert.equal(generated[0].modelProvider, first.modelProvider);
  finish("修复网页对话标题");
  await waitFor(() => generated.length === 2);
  assert.equal(app.writes.length, 1);
  finish("补齐历史对话标题");
  await waitFor(() => app.writes.length === 2);
  assert.deepEqual(
    app.writes.map((r) => r.threadId),
    [first.id, second.id],
  );
});

test("已有标题、子代理、临时会话、空消息和归档会话跳过生成", async () => {
  let generated = 0;
  const app = namingFixture(async () => {
    generated++;
    return "标题";
  });
  for (const [id, extra] of [
    ["named", { name: "手动标题" }],
    ["ephemeral", { ephemeral: true }],
    ["child", { parentThreadId: "parent-fixture" }],
    [
      "legacy-child",
      {
        source: {
          subAgent: {
            thread_spawn: { parent_thread_id: "parent-fixture", depth: 1 },
          },
        },
      },
    ],
    ["empty", { preview: " " }],
    ["archived", { path: "/fixture/archived_sessions/fixture.jsonl" }],
  ])
    app.naming.schedule(app.add(id, extra));
  await delay(10);
  assert.equal(generated, 0);
  assert.equal(app.writes.length, 0);
});

for (const change of ["rename", "archive", "cancel", "disconnect"]) {
  test(`生成期间发生 ${change} 时保留较新的操作`, async () => {
    let finish,
      started = false;
    const app = namingFixture(() => {
      started = true;
      return new Promise((resolve) => (finish = resolve));
    });
    const thread = app.add("title-changing");
    app.naming.schedule(thread);
    await waitFor(() => started);
    if (change === "rename") thread.name = "手动选择的标题";
    if (change === "archive")
      thread.path = "/fixture/archived_sessions/fixture.jsonl";
    if (change === "cancel") app.naming.cancel(thread.id);
    if (change === "disconnect") app.naming.clear();
    finish("迟到的自动标题");
    await delay(10);
    assert.equal(app.writes.length, 0);
    assert.equal(app.errors.length, 0);
  });
}

test("标题生成失败后可在再次打开时重试", async () => {
  let attempts = 0;
  const app = namingFixture(async () => {
    if (++attempts === 1) throw new Error("模拟标题请求失败");
    return "重试后的标题";
  });
  const thread = app.add("title-retry");
  app.naming.schedule(thread);
  await waitFor(() => app.errors.length === 1);
  app.naming.schedule(thread);
  await waitFor(() => app.writes.length === 1);
  assert.equal(app.writes[0].name, "重试后的标题");
});

test(
  "网页首次发送和打开历史触发持久化标题，页面关闭后继续生成",
  { timeout: 10000 },
  async (t) => {
    const threads = new Map([
      ["title-new", { id: "title-new", preview: "", model: "fixture-model" }],
      ["title-history", { id: "title-history", preview: "帮我检查部署错误" }],
    ]);
    let main;
    let generated = 0;
    const app = await backend(t, (request, socket) => {
      if (request.method === "initialize") {
        if (request.params.clientInfo.name === "claudex_web") main = socket;
        return respond(socket, request, {});
      }
      if (request.id === undefined) return;
      if (socket !== main) {
        if (request.method === "turn/start") {
          generated++;
          completeTitle(
            socket,
            JSON.stringify({ title: "自动概括的任务标题" }),
          );
        }
        return titleResponse(request, socket);
      }
      const p = request.params;
      if (request.method === "thread/start")
        return respond(socket, request, { thread: threads.get("title-new") });
      if (["thread/read", "thread/resume"].includes(request.method))
        return respond(socket, request, { thread: threads.get(p.threadId) });
      if (request.method === "turn/start") {
        threads.get(p.threadId).preview = p.input[0].text;
        return respond(socket, request, {
          turn: { id: "user-turn", status: "inProgress" },
        });
      }
      if (request.method === "thread/name/set") {
        threads.get(p.threadId).name = p.name;
        notify(socket, "thread/name/updated", {
          threadId: p.threadId,
          threadName: p.name,
        });
      }
      respond(socket, request, {});
    });
    const directory = await mkdtemp(join(tmpdir(), "claudex-web-title-auth-"));
    const auth = await authenticationFixture(directory);
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../src/server.mjs", import.meta.url))],
      {
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          CODEX_HOME: directory,
          CLAUDEX_WEB_CONFIG_DIR: directory,
          PORT: "0",
          CODEX_APP_SERVER_URL: app.url,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const sockets = [];
    t.after(async () => {
      for (const socket of sockets) socket.terminate();
      const exited = once(child, "exit");
      child.kill();
      await exited;
      await rm(directory, { recursive: true, force: true });
    });
    const url = await new Promise((resolve) =>
      child.stdout.on("data", (bytes) => {
        const match = bytes.toString().match(/https:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0].replace("https:", "wss:") + "/rpc");
      }),
    );
    let latestState;
    async function connect() {
      const socket = new WebSocket(url, {
        ca: auth.tls.cert,
        headers: {
          Cookie: auth.cookie,
          Origin: new URL(url).origin.replace("wss:", "https:"),
        },
      });
      sockets.push(socket);
      await new Promise((resolve) =>
        socket.on("message", (bytes) => {
          const m = JSON.parse(bytes);
          if (m.method === "lan/state" && m.params.ready) {
            latestState = m.params;
            resolve();
          }
        }),
      );
      return socket;
    }
    let sequence = 0;
    function rpc(socket, method, params = {}) {
      return new Promise((resolve) => {
        const id = ++sequence;
        const receive = (bytes) => {
          const m = JSON.parse(bytes);
          if (m.id !== id || m.method) return;
          socket.off("message", receive);
          resolve(m.result);
        };
        socket.on("message", receive);
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    const client = await connect();
    const observer = await connect();
    const notifications = [];
    observer.on("message", (bytes) => notifications.push(JSON.parse(bytes)));
    await rpc(client, "thread/start");
    await rpc(client, "turn/start", {
      threadId: "title-new",
      input: [{ type: "text", text: "给网页增加自动标题" }],
    });
    client.close();
    await waitFor(() => threads.get("title-new").name);
    await rpc(observer, "thread/read", { threadId: "title-history" });
    await waitFor(() => threads.get("title-history").name);
    await rpc(observer, "thread/read", { threadId: "title-history" });
    assert.equal(generated, 2);
    assert.equal(
      notifications.filter((m) => m.method === "thread/name/updated").length,
      2,
    );
    assert(
      !notifications.some((m) => JSON.stringify(m).includes("title-ephemeral")),
    );
    await connect();
    // 临时标题轮次保持独立，用户的实际轮次继续运行。
    assert.deepEqual(latestState.activeTurns, { "title-new": "user-turn" });
    assert(!app.requests.some((r) => r.method === "turn/interrupt"));
    assert.equal(threads.get("title-new").name, "自动概括的任务标题");
  },
);
