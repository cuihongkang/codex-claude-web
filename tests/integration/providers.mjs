import { dynamicTools, createLedger } from "./provider-tools.mjs";
import { isolatedCodex } from "./codex-backend.mjs";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import WebSocket from "ws";
import { createWebApplication } from "../../server/src/application.mjs";
import { createAuthentication } from "../../server/src/auth.mjs";
import { readConfig } from "../../server/src/config.mjs";
import { authenticationFixture } from "../helpers/auth.mjs";

if (!process.env.MODEL_BASE_URL || !process.env.MODEL_ID)
  throw new Error(
    "需要 MODEL_BASE_URL、MODEL_ID 和 CODEX_APP_SERVER_URL，运行真实供应商集成验证。",
  );
const home = await mkdtemp(join(tmpdir(), "codex-web-provider-live-"));
const backend =
  process.env.PROVIDER_ISOLATED === "1" ? await isolatedCodex(home) : null;
const auth = await authenticationFixture(home);
const config = readConfig({
  ...process.env,
  ...(backend && { CODEX_APP_SERVER_URL: backend.url }),
  CODEX_HOME: home,
  PORT: "0",
  HOST: "127.0.0.1",
});
const app = createWebApplication({
  config,
  tls: auth.tls,
  authentication: await createAuthentication(config),
  version: { displayVersion: "3.1.0" },
});
const ledger = createLedger();
const events = [],
  checks = [],
  pending = new Map();
let socket,
  sequence = 0,
  threadId;
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("请求超时：" + method));
    }, 300000);
    pending.set(id, {
      resolve: (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function event(method, match, mark) {
  const deadline = Date.now() + 600000;
  while (Date.now() < deadline) {
    const found = events
      .slice(mark)
      .find((e) => e.method === method && match(e.params));
    if (found) return found.params;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("事件超时：" + method);
}
async function check(name, run) {
  console.log("START " + name);
  const detail = await run();
  checks.push({ name, status: "passed", ...detail });
  console.log("PASS " + name);
}
async function turn(providerId, model, text) {
  const mark = events.length;
  const started = await call("turn/start", {
    threadId,
    providerId,
    model,
    input: [{ type: "text", text }],
    ...(providerId === "codex" && { effort: "high" }),
  });
  const ended = await event(
    "turn/completed",
    (p) => p.threadId === threadId && p.turn.id === started.turn.id,
    mark,
  );
  assert.equal(
    ended.turn.status,
    "completed",
    JSON.stringify(ended.turn.error)?.slice(0, 1000),
  );
  return events.slice(mark);
}
try {
  await app.start();
  const url = `wss://127.0.0.1:${app.server.address().port}/rpc`;
  socket = new WebSocket(url, {
    ca: auth.tls.cert,
    headers: {
      Cookie: auth.cookie,
      Origin: url.replace("wss:", "https:").replace("/rpc", ""),
    },
  });
  socket.on("message", (bytes) => {
    const m = JSON.parse(bytes);
    if (m.method) {
      events.push(m);
      ledger.handle(socket, m);
    } else {
      const waiter = pending.get(m.id);
      if (waiter) {
        pending.delete(m.id);
        m.error
          ? waiter.reject(new Error(m.error.message))
          : waiter.resolve(m.result);
      }
    }
  });
  await event("lan/state", (p) => p.ready, 0);
  const model = process.env.MODEL_ID,
    gpt = process.env.GPT_MODEL || "gpt-6-luna";
  await call("lan/providers/set", {
    id: "live-test",
    name: "真实模型验证",
    baseUrl: process.env.MODEL_BASE_URL,
    protocol: "chat",
    apiKey: process.env.MODEL_API_KEY || "",
    models: [{ id: model, contextWindow: 196608, maxOutputTokens: 4096 }],
  });
  const created = await call("thread/start", {
    providerId: "codex",
    model: gpt,
    cwd: home,
    dynamicTools,
    developerInstructions:
      "When asked to update the synthetic ledger, use ledger_read then ledger_add with the returned revision, then ledger_read to verify. Do not substitute shell commands for these ledger tools. On a conflict read again and retry once. Preserve the task codename, ledger balance and revision in context summaries.",
    approvalPolicy: "never",
    sandbox: "danger-full-access",
  });
  threadId = created.thread.id;
  await call("thread/name/set", { threadId, name: "多供应商集成验证（临时）" });
  const codename = "PROJECT-" + Math.random().toString(36).slice(2, 10);
  const textOf = (result) =>
    result
      .filter(
        (e) =>
          e.method === "item/completed" &&
          e.params.item.type === "agentMessage",
      )
      .map((e) => e.params.item.text)
      .join("\n");
  const marker = createHash("sha256").update(home).digest("hex").slice(0, 12);
  await check("GPT-6-Luna 创建原生对话与工具记录", async () => {
    const result = await turn(
      "codex",
      gpt,
      `本次任务代号是 ${codename}，请记住此代号，并在后续摘要中保留。请执行终端命令，把 ${marker} 写入 marker.txt，然后读取并确认。只执行这一项任务。`,
    );
    assert.equal(
      (await readFile(join(home, "marker.txt"), "utf8")).trim(),
      marker,
    );
    return {
      toolItems: result.filter(
        (e) =>
          e.method === "item/completed" &&
          e.params.item.type === "commandExecution",
      ).length,
    };
  });
  await check("同一对话切换开源模型并连续执行依赖工具", async () => {
    const result = await turn(
      "live-test",
      model,
      "请依次使用终端工具：1. 读取 marker.txt；2. 把数字 137 写入 a.txt；3. 读取 a.txt，计算它加 349，将结果写入 sum.txt；4. 读取 sum.txt 并报告数字及 marker.txt 中的标记。每一步都以工具实际读取的结果为准。",
    );
    assert.equal((await readFile(join(home, "sum.txt"), "utf8")).trim(), "486");
    const tools = result.filter(
      (e) =>
        e.method === "item/completed" &&
        e.params.item.type === "commandExecution",
    ).length;
    assert.ok(tools >= 1, "真实终端执行");
    return { toolItems: tools };
  });
  await check("同一轮连续依赖工具调用和下一轮失败重试", async () => {
    const begin = ledger.calls.length;
    await turn(
      "live-test",
      model,
      "使用 ledger_read 读取账本，再用 ledger_add 加上 349，然后 ledger_read 核对结果。",
    );
    assert.equal(ledger.state.balance, 486);
    assert.deepEqual(
      ledger.calls.slice(begin).map((c) => c.tool),
      ["ledger_read", "ledger_add", "ledger_read"],
    );
    ledger.failOnce();
    const retry = ledger.calls.length;
    await turn(
      "live-test",
      model,
      "继续使用账本工具读取、加上 11、再读取核对。如遇版本冲突，请重新读取并重试。",
    );
    assert.equal(ledger.state.balance, 497);
    assert.ok(ledger.calls.slice(retry).some((c) => !c.success));
    assert.ok(ledger.calls.length - retry >= 5);
    return { toolCalls: ledger.calls.length - begin };
  });
  await check("开源模型原生手动整理上下文", async () => {
    const mark = events.length;
    await call("thread/compact/start", { threadId });
    const ended = await event(
      "turn/completed",
      (p) => p.threadId === threadId,
      mark,
    );
    assert.equal(
      ended.turn.status,
      "completed",
      JSON.stringify(ended.turn.error),
    );
    return {};
  });
  await check("整理后切回 GPT-6-Luna，继续原对话与工具", async () => {
    const result = await turn(
      "codex",
      gpt,
      "先复述之前约定的任务代号，再继续刚才的任务。请使用终端读取 sum.txt 和 marker.txt，确认数字和标记。把数字乘以 2 后写入 doubled.txt。不要改动前面的文件。",
    );
    assert.ok(textOf(result).includes(codename), "整理后 GPT 恢复对话专属信息");
    assert.equal(
      (await readFile(join(home, "doubled.txt"), "utf8")).trim(),
      "972",
    );
    return {
      toolItems: result.filter(
        (e) =>
          e.method === "item/completed" &&
          e.params.item.type === "commandExecution",
      ).length,
    };
  });
  await check("GPT 原生整理后保留可迁移上下文", async () => {
    const mark = events.length;
    await call("thread/compact/start", { threadId });
    const ended = await event(
      "turn/completed",
      (p) => p.threadId === threadId,
      mark,
    );
    assert.equal(
      ended.turn.status,
      "completed",
      JSON.stringify(ended.turn.error)?.slice(0, 1000),
    );
    return {};
  });
  await check("再次切回开源模型并恢复供应商元数据", async () => {
    await turn("live-test", model, "请使用终端读取 doubled.txt，报告数字。");
    const read = await call("thread/read", { threadId, includeTurns: false });
    assert.equal(read.thread.providerId, "live-test");
    assert.equal(read.thread.id, threadId);
    return {};
  });
  await writeFile(
    process.env.PROVIDER_RESULT || join(home, "result.json"),
    JSON.stringify({ status: "passed", checks }, null, 2) + "\n",
  );
  console.log(JSON.stringify({ status: "passed", checks }));
} finally {
  if (socket?.readyState === WebSocket.OPEN && threadId) {
    try {
      await call("thread/archive", { threadId });
    } catch {}
  }
  socket?.terminate();
  await app.close();
  await backend?.close();
  await rm(home, { recursive: true, force: true });
}
