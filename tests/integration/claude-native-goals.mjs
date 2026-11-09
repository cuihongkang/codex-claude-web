import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createSessionReader } from "../../server/src/backends/claude/history.mjs";
import { createClaudeRuntime } from "../../server/src/backends/claude/runtime.mjs";
import { createStorage } from "../../server/src/backends/storage.mjs";
import { createCompactions } from "../../server/src/compaction.mjs";
import { messagesServer } from "../helpers/claude-messages-server.mjs";

const dir = await mkdtemp(join(tmpdir(), "claude-native-goals-"));
const cwd = join(dir, "workspace");
await mkdir(cwd);
const events = [];
let respond = () => [{ type: "text", text: "完成" }];
let modelCapabilities = {};
const service = await messagesServer((body, requests) =>
  respond(body, requests),
);
const id = randomUUID();
const storage = createStorage(join(dir, "index.json"), {
  sessions: {
    [id]: {
      id,
      cwd,
      providerId: "fixture",
      model: "fixture-model",
      queue: [],
      turns: {},
      createdAt: Date.now() / 1000,
    },
  },
});
const broadcast = (event) => events.push(event);
const runtime = createClaudeRuntime({
  backend: {
    id: "claude",
    executable: process.env.CLAUDE_EXECUTABLE || "claude",
    dataDir: join(dir, "config"),
    stateDir: join(dir, "web-state"),
    args: [],
  },
  storage,
  providers: {
    get: async () => ({
      id: "fixture",
      protocol: "messages",
      baseUrl: service.url,
      apiKey: "test-token",
      models: ["fixture-model"],
      modelCapabilities,
    }),
  },
  broadcast,
  compactions: createCompactions(broadcast),
  questions: new Map(),
});
async function until(predicate, description) {
  for (let i = 0; i < 1600; i++) {
    if (await predicate()) return;
    await delay(25);
  }
  throw new Error(
    `等待超时：${description}\n${JSON.stringify(events.slice(-8))}`,
  );
}
try {
  let attempts = 0;
  let evaluate = () => ({ ok: attempts >= 2, reason: "核对实际结果" });
  let release;
  respond = async (body) => {
    if (
      JSON.stringify(body.system).includes("evaluating a stop-condition hook")
    )
      return [{ type: "text", text: JSON.stringify(await evaluate()) }];
    attempts++;
    if (release) await new Promise((resolve) => (release.resolve = resolve));
    return [{ type: "text", text: "实际目标工作" }];
  };
  const set = (p) =>
    runtime.goals.handlers.get("thread/goal/set")({ threadId: id, ...p });
  const clear = () =>
    runtime.goals.handlers.get("thread/goal/clear")({ threadId: id });
  await set({ objective: "原生目标自动继续与完成", tokenBudget: 10000 });
  await until(
    async () => (await runtime.goals.read(id))?.status === "complete",
    "原生目标完成",
  );
  await until(() => !runtime.running.has(id), "完成轮次结算");
  assert.ok(attempts >= 2);
  assert.ok(
    service.requests.every((body) => body.output_config?.effort === undefined),
    "主请求与原生Stop评估请求均保留未选择effort的状态",
  );
  for (const body of service.requests.filter(
    (body) =>
      body.tools?.some((tool) => tool.name === "Bash") ||
      JSON.stringify(body.system).includes("evaluating a stop-condition hook"),
  ))
    assert.deepEqual(
      body.thinking,
      body.tools?.some((tool) => tool.name === "Bash")
        ? { type: "adaptive", display: "summarized" }
        : { type: "disabled" },
      "主请求和评估请求分别沿用各自原生思考控制",
    );
  assert.ok(
    service.requests.some((b) =>
      JSON.stringify(b.system).includes("evaluating a stop-condition hook"),
    ),
  );
  for (const body of service.requests.filter((body) =>
    JSON.stringify(body.system).includes("evaluating a stop-condition hook"),
  )) {
    assert.equal(
      body.output_config?.format?.type,
      "json_schema",
      "原生目标评估保留结构化输出控制",
    );
    assert.deepEqual(body.output_config.format.schema.required, [
      "ok",
      "reason",
    ]);
  }
  assert.ok(
    !service.requests.some((b) =>
      b.tools?.some((t) => t.name.includes("codex_web_goal")),
    ),
  );
  const native = runtime.queries.get(id);
  assert.ok(
    !(await native.query.getHooksListing()).hooks.some(
      (h) => h.source === "sessionHook" && h.event === "Stop",
    ),
  );
  const backend = { dataDir: join(dir, "config") };
  const readNative = createSessionReader(backend);
  const original = (await storage.read()).sessions[id];
  const persisted = await readNative(
    "getNativeGoalStatus",
    original.nativeSessionId || id,
    { dir: cwd },
  );
  assert.equal(persisted.met, true);
  assert.equal(persisted.sentinel, undefined);
  const completedEvents = events.filter(
    (e) => e.method === "turn/started",
  ).length;
  await clear();
  assert.equal(
    events.filter((e) => e.method === "turn/started").length,
    completedEvents,
    "clear不产生伪用户轮次",
  );

  evaluate = () => "invalid native evaluator response";
  const beforeInvalid = events.filter(
    (e) => e.method === "turn/started",
  ).length;
  await set({ objective: "核对原生评估失败状态", tokenBudget: 10000 });
  await until(
    async () => (await runtime.goals.read(id))?.status === "blocked",
    "原生评估失败及时结束活动状态",
  );
  await until(() => !runtime.running.has(id), "评估失败轮次结束");
  const invalid = await runtime.goals.read(id);
  assert.equal(
    invalid.nativeStatus.evaluationError.type,
    "hook_non_blocking_error",
  );
  assert.equal(
    invalid.error.message,
    invalid.nativeStatus.evaluationError.stderr,
  );
  assert.equal(
    events.filter((e) => e.method === "turn/started").length,
    beforeInvalid + 1,
    "原生评估失败不补发目标或制造额外轮次",
  );
  await clear();
  evaluate = async () => {
    await delay(31000);
    return { ok: true, reason: "超过原生评估deadline的迟到结果" };
  };
  await set({ objective: "核对原生评估超时状态", tokenBudget: 10000 });
  await until(
    async () => (await runtime.goals.read(id))?.status === "blocked",
    "原生30秒评估超时结算",
  );
  await until(() => !runtime.running.has(id), "评估超时轮次结束");
  assert.ok((await runtime.goals.read(id)).error.message);
  await clear();
  release = {};
  evaluate = () => ({ ok: false, reason: "仍需继续" });
  await set({ objective: "暂停再恢复原生目标", tokenBudget: 10000 });
  await until(() => release.resolve, "原生主请求已开始");
  const paused = set({ status: "paused" });
  release.resolve();
  release = null;
  await paused;
  assert.equal((await runtime.goals.read(id)).status, "paused");
  assert.ok(
    !(await native.query.getHooksListing()).hooks.some(
      (h) => h.source === "sessionHook" && h.event === "Stop",
    ),
  );
  evaluate = () => ({ ok: true, reason: "恢复后核验完成" });
  await set({ status: "active" });
  await until(
    async () => (await runtime.goals.read(id))?.status === "complete",
    "暂停后恢复完成",
  );
  await until(() => !runtime.running.has(id), "恢复轮次结束");
  await clear();
  evaluate = () => ({
    ok: false,
    impossible: true,
    reason: "外部验证资源不可用",
  });
  await set({ objective: "原生评估器报告阻塞", tokenBudget: 10000 });
  await until(
    async () => (await runtime.goals.read(id))?.status === "blocked",
    "原生不可能完成状态",
  );
  await until(() => !runtime.running.has(id), "阻塞结算");
  assert.equal((await runtime.goals.read(id)).nativeStatus.failed, true);
  await clear();
  evaluate = () => ({ ok: false, reason: "继续" });
  await set({ objective: "原生目标预算", tokenBudget: 10 });
  await until(
    async () => (await runtime.goals.read(id))?.status === "budgetLimited",
    "实际token预算",
  );
  await until(() => !runtime.running.has(id), "预算中断");
  await until(
    async () =>
      !(await native.query.getHooksListing()).hooks.some(
        (h) => h.source === "sessionHook" && h.event === "Stop",
      ),
    "预算清除原生hook",
  );
  await clear();
  modelCapabilities = { "fixture-model": { supportedEffortLevels: ["low"] } };
  evaluate = () => ({ ok: true, reason: "低强度核验完成" });
  const lowTurn = await runtime.enqueue(id, {
    input: [{ type: "text", text: "选择低强度" }],
    effort: "low",
  });
  await until(
    () =>
      events.some(
        (e) =>
          e.method === "turn/completed" && e.params.turn.id === lowTurn.turn.id,
      ),
    "低强度设置",
  );
  const lowStart = service.requests.length;
  await set({ objective: "原生低强度目标", tokenBudget: 10000 });
  await until(
    async () => (await runtime.goals.read(id))?.status === "complete",
    "低强度目标完成",
  );
  await until(() => !runtime.running.has(id), "低强度轮次结束");
  const lowRequests = service.requests.slice(lowStart);
  assert.ok(
    lowRequests.some((body) =>
      JSON.stringify(body.system).includes("evaluating a stop-condition hook"),
    ),
  );
  assert.ok(
    lowRequests.every((body) => body.output_config?.effort === "low"),
    "主请求与原生评估请求均遵循实际所选low",
  );
  await clear();
  const latestNative = runtime.queries.get(id).query;
  await latestNative.applyFlagSettings({ disableAllHooks: true });
  await set({ objective: "原生低强度目标", tokenBudget: 10000 });
  await until(
    async () => (await runtime.goals.read(id))?.status === "blocked",
    "原生策略拒绝目标",
  );
  await until(() => !runtime.running.has(id), "策略拒绝结算");
  assert.equal(
    (await runtime.goals.read(id)).nativeBaselineId,
    (await runtime.goals.read(id)).nativeStatus.nativeRecordId,
    "相同目标的旧成功记录保留原生UUID，不冒充本次成功",
  );
  await latestNative.applyFlagSettings({ disableAllHooks: false });
  await clear();
  const records = await readNative(
    "getSessionMessages",
    original.nativeSessionId || id,
    { dir: cwd },
  );
  const latest = (await storage.read()).sessions[id];
  const internal = records.filter((m) => latest.internalInputIds?.[m.uuid]);
  assert.ok(internal.length > 0);
  assert.ok(
    internal.every((m) => JSON.stringify(m.message?.content).includes("goal")),
  );
  console.log(
    "Claude native goals passed: native Stop evaluator, automatic continuation, native completion/history, pause/resume, impossible/blocked, real token budget and invisible UUID-scoped commands",
  );
} finally {
  runtime.close();
  await service.close();
  if (process.env.KEEP_NATIVE_GOAL_FIXTURE) console.log("FIXTURE", dir);
  else await rm(dir, { recursive: true, force: true });
}
