import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { createClaudeRuntime } from "../../server/src/backends/claude/runtime.mjs";
import { createStorage } from "../../server/src/backends/storage.mjs";
import { createCompactions } from "../../server/src/compaction.mjs";
import { messagesServer } from "../helpers/claude-messages-server.mjs";

const dir = await mkdtemp(join(tmpdir(), "claude-runtime-lifecycle-"));
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
async function completed(turnId) {
  await until(
    () =>
      events.some(
        (e) => e.method === "turn/completed" && e.params.turn.id === turnId,
      ),
    "轮次结束",
  );
  const turn = events.find(
    (e) => e.method === "turn/completed" && e.params.turn.id === turnId,
  ).params.turn;
  assert.equal(turn.status, "completed", JSON.stringify(turn));
}
const send = (text, extra = {}) =>
  runtime.enqueue(id, { input: [{ type: "text", text }], ...extra });
try {
  await runtime.check();
  const first = await send("第一轮");
  await completed(first.turn.id);
  const firstRequest = service.requests.find(
    (request) =>
      request.tools?.some((tool) => tool.name === "Bash") &&
      JSON.stringify(request.messages).includes("第一轮"),
  );
  assert.deepEqual(
    firstRequest.thinking,
    { type: "adaptive", display: "summarized" },
    "未配置思考行为时首次请求沿用原生默认",
  );
  assert.equal(
    firstRequest.output_config?.effort,
    undefined,
    "未声明effort时首次请求省去默认high",
  );
  const native = runtime.queries.get(id).query;
  assert.equal(runtime.running.size, 0);
  assert.equal(runtime.queries.get(id).ended, undefined);
  const second = await send("第二轮");
  await completed(second.turn.id);
  assert.equal(runtime.queries.get(id).query, native, "多轮使用同一个原生进程");
  assert.ok(
    service.requests
      .at(-1)
      .messages.some((m) => JSON.stringify(m.content).includes("第一轮")),
  );
  const usage = (await storage.read()).sessions[id].tokenUsage;
  assert.ok(usage.total.totalTokens >= 240);
  assert.ok(usage.last.totalTokens > 0);
  assert.ok(usage.modelContextWindow > 0);
  assert.notEqual(
    usage.last.totalTokens,
    usage.total.totalTokens,
    "上下文与累计用量分别核对",
  );

  let releaseResponse;
  const gate = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  respond = async () => {
    await gate;
    return [{ type: "text", text: "已接收补充" }];
  };
  const third = await send("第三轮等待补充");
  await until(
    () =>
      service.requests.some((r) =>
        JSON.stringify(r.messages).includes("第三轮等待补充"),
      ),
    "第三轮请求",
  );
  await runtime.steer(id, {
    expectedTurnId: third.turn.id,
    input: [{ type: "text", text: "运行中补充" }],
  });
  releaseResponse();
  await completed(third.turn.id);
  await until(
    () =>
      service.requests.some((r) =>
        JSON.stringify(r.messages).includes("运行中补充"),
      ),
    "补充送达原生会话",
  );
  assert.equal(runtime.queries.get(id).query, native);

  let requestedBash = false;
  respond = () => {
    if (!requestedBash) {
      requestedBash = true;
      return [
        {
          type: "tool_use",
          id: "toolu_background_fixture",
          name: "Bash",
          input: {
            command: "printf background-ready; sleep 90",
            description: "后台等待",
            run_in_background: true,
          },
        },
      ];
    }
    return [{ type: "text", text: "后台任务已启动" }];
  };
  const fourth = await send("启动后台终端");
  await completed(fourth.turn.id);
  const list = runtime.tasks.handlers.get("thread/backgroundTerminals/list");
  await until(
    async () => (await list({ threadId: id })).data.length > 0,
    "后台任务在轮次结束后仍在运行",
  );
  const tasks = await list({ threadId: id });
  assert.equal(tasks.data.length, 1);
  const output = await native.getTaskOutput(tasks.data[0].processId);
  assert.ok(
    JSON.stringify(output).includes("background-ready"),
    "后台输出来自原生get_task_output",
  );
  let foregroundRelease;
  respond = async () => {
    await new Promise((resolve) => (foregroundRelease = resolve));
    return [{ type: "text", text: "前台结束" }];
  };
  const foreground = await send("验证停止前台保留后台");
  await until(() => foregroundRelease, "前台请求已开始");
  await runtime.interrupt(id);
  foregroundRelease();
  await until(
    () =>
      events.some(
        (e) =>
          e.method === "turn/completed" &&
          e.params.turn.id === foreground.turn.id,
      ),
    "前台中断完成",
  );
  assert.equal(
    (await list({ threadId: id })).data.length,
    1,
    "原生perTaskStopAffordance保留独立后台任务",
  );
  await runtime.tasks.handlers.get("thread/backgroundTerminals/clean")({
    threadId: id,
  });
  assert.equal((await list({ threadId: id })).data.length, 0);

  let wakeTask = false;
  respond = (body) => {
    if (!wakeTask && body.tools?.some((tool) => tool.name === "Bash")) {
      wakeTask = true;
      return [
        {
          type: "tool_use",
          id: "toolu_background_wake",
          name: "Bash",
          input: {
            command: "sleep 2; printf background-wake",
            description: "完成后唤醒对话",
            run_in_background: true,
          },
        },
      ];
    }
    return [{ type: "text", text: "已处理后台结果" }];
  };
  const backgroundWake = await send("启动完成后会唤醒的后台工作");
  await completed(backgroundWake.turn.id);
  await until(
    () =>
      events.some(
        (e) => e.method === "turn/completed" && e.params.turn.automatic,
      ),
    "后台完成后自动轮次结束",
  );
  const automatic = events.find(
    (e) => e.method === "turn/completed" && e.params.turn.automatic,
  ).params.turn;
  assert.ok(automatic.nativeAnchorId);
  assert.ok(
    automatic.items.some(
      (item) =>
        item.type === "agentMessage" && item.text.includes("已处理后台结果"),
    ),
  );

  respond = () => [
    { type: "text", text: "## 执行方案\n\n1. 调查\n2. 实施\n3. 验证" },
  ];
  const planned = await send("制定方案", {
    collaborationMode: { mode: "plan" },
  });
  await completed(planned.turn.id);
  assert.ok(
    events.some(
      (e) =>
        e.method === "item/plan/delta" && e.params.turnId === planned.turn.id,
    ),
  );
  assert.ok(
    events.some(
      (e) =>
        e.method === "item/completed" &&
        e.params.turnId === planned.turn.id &&
        e.params.item.type === "plan",
    ),
  );
  const approved = await send("执行以上完整方案", {
    collaborationMode: { mode: "default" },
  });
  await completed(approved.turn.id);
  assert.equal(
    runtime.queries.get(id).query,
    native,
    "计划批准原地切换权限模式",
  );
  let reviewWrite = false;
  respond = () => {
    if (!reviewWrite) {
      reviewWrite = true;
      return [
        {
          type: "tool_use",
          id: "toolu_review_write",
          name: "Bash",
          input: {
            command: "printf mutated > review-mutation.txt",
            description: "尝试写入用于验证只读权限",
          },
        },
      ];
    }
    return [{ type: "text", text: "只读审查结束" }];
  };
  const reviewed = await send("/code-review 当前项目所有未提交变更，只读审查", {
    review: true,
  });
  await completed(reviewed.turn.id);
  assert.ok(
    service.requests.some((body) =>
      JSON.stringify(body.messages).includes("## Phase 0 — Gather the diff"),
    ),
    "审查使用原生code-review扩展指令",
  );
  await assert.rejects(access(join(cwd, "review-mutation.txt")), {
    code: "ENOENT",
  });
  respond = () => [{ type: "text", text: "整理后的摘要" }];
  const compacted = await runtime.enqueue(id, {}, true);
  await completed(compacted.turn.id);

  let releaseInterrupt;
  const interruptedGate = new Promise((resolve) => {
    releaseInterrupt = resolve;
  });
  respond = async () => {
    await interruptedGate;
    return [{ type: "text", text: "迟到响应" }];
  };
  const interrupted = await send("验证中断");
  await until(
    () =>
      service.requests.some((r) =>
        JSON.stringify(r.messages).includes("验证中断"),
      ),
    "中断前实际请求",
  );
  await runtime.interrupt(id);
  releaseInterrupt();
  await until(
    () =>
      events.some(
        (e) =>
          e.method === "turn/completed" &&
          e.params.turn.id === interrupted.turn.id,
      ),
    "中断完成事件",
  );
  assert.equal(
    events.find(
      (e) =>
        e.method === "turn/completed" &&
        e.params.turn.id === interrupted.turn.id,
    ).params.turn.status,
    "interrupted",
  );

  let goalAttempts = 0;
  respond = (body) => {
    if (
      JSON.stringify(body.system).includes("evaluating a stop-condition hook")
    )
      return [
        {
          type: "text",
          text: JSON.stringify({
            ok: goalAttempts >= 2,
            reason: goalAttempts >= 2 ? "已核验完成" : "需要继续核验",
          }),
        },
      ];
    goalAttempts++;
    return [
      {
        type: "text",
        text: goalAttempts >= 2 ? "目标已验证完成" : "目标仍需继续验证",
      },
    ];
  };
  await runtime.goals.handlers.get("thread/goal/set")({
    threadId: id,
    objective: "完成隔离目标验证",
    tokenBudget: 5000,
    origin: "user",
  });
  await until(
    async () => (await runtime.goals.read(id))?.status === "complete",
    "原生评估器完成目标",
  );
  await until(() => !runtime.running.has(id), "目标轮次结束");
  assert.ok((await runtime.goals.read(id)).tokensUsed > 0);
  assert.ok(goalAttempts >= 2, "原生 Stop 评估器持续驱动直到实际完成");
  await runtime.goals.handlers.get("thread/goal/clear")({ threadId: id });
  respond = () => [{ type: "text", text: "已消耗预算" }];
  await runtime.goals.handlers.get("thread/goal/set")({
    threadId: id,
    objective: "验证预算边界",
    tokenBudget: 10,
    origin: "user",
  });
  await until(
    async () => (await runtime.goals.read(id))?.status === "budgetLimited",
    "实时预算限制",
  );
  await until(() => !runtime.running.has(id), "预算耗尽停止执行");
  assert.ok((await runtime.goals.read(id)).tokensUsed >= 10);
  await runtime.goals.handlers.get("thread/goal/set")({
    threadId: id,
    status: "paused",
  });
  assert.equal((await runtime.goals.read(id)).status, "paused");
  await runtime.goals.handlers.get("thread/goal/clear")({ threadId: id });
  assert.equal(await runtime.goals.read(id), null);
  modelCapabilities = {
    "fixture-model": { supportedEffortLevels: ["low", "high"] },
  };
  respond = () => [{ type: "text", text: "参数验证" }];
  const unspecified = await send("声明low但未选择effort");
  await completed(unspecified.turn.id);
  const lowNative = runtime.queries.get(id).query;
  assert.equal(
    service.requests.findLast((b) => b.tools?.some((t) => t.name === "Bash"))
      .output_config?.effort,
    undefined,
  );
  for (const effort of ["low", "high", undefined]) {
    const selected = await send("动态effort:" + effort, { effort });
    await completed(selected.turn.id);
    assert.equal(
      runtime.queries.get(id).query,
      lowNative,
      "effort切换复用原生会话",
    );
    assert.equal(
      service.requests.findLast((b) => b.tools?.some((t) => t.name === "Bash"))
        .output_config?.effort,
      effort,
    );
  }
  modelCapabilities = {
    "fixture-model": {
      supportedEffortLevels: ["high"],
      supportsAdaptiveThinking: true,
    },
  };
  respond = () => [{ type: "text", text: "已使用显式模型参数" }];
  const configured = await send("核对显式模型参数", { effort: "high" });
  await completed(configured.turn.id);
  const configuredRequest = service.requests.findLast(
    (request) =>
      request.tools?.some((tool) => tool.name === "Bash") &&
      JSON.stringify(request.messages).includes("核对显式模型参数"),
  );
  assert.equal(configuredRequest.thinking?.type, "adaptive");
  assert.equal(configuredRequest.output_config?.effort, "high");
  await promisify(execFile)("git", ["init", "--quiet"], { cwd });
  let wroteBash = false;
  respond = (body) => {
    if (!wroteBash && body.tools?.some((tool) => tool.name === "Bash")) {
      wroteBash = true;
      return [
        {
          type: "tool_use",
          id: "toolu_git_change",
          name: "Bash",
          input: {
            command: "printf generated > actual-bash.txt",
            description: "写入隔离验证文件",
          },
        },
      ];
    }
    return [{ type: "text", text: "文件已生成" }];
  };
  const bashChanged = await send("验证真实Bash变更记录");
  await completed(bashChanged.turn.id);
  assert.ok(
    events.some(
      (event) =>
        event.method === "item/completed" &&
        event.params.turnId === bashChanged.turn.id &&
        event.params.item.type === "fileChange" &&
        event.params.item.changes.some((change) =>
          change.path.endsWith("actual-bash.txt"),
        ),
    ),
  );
  const released = runtime.queries.get(id);
  await runtime.releaseUnusedThreads(released.lastActivityAt + 300001);
  assert.equal(runtime.queries.has(id), false);
  await released.done;
  const resumed = await send("空闲释放后的恢复");
  await completed(resumed.turn.id);
  assert.notEqual(runtime.queries.get(id).query, released.query);
  assert.ok(
    service.requests
      .findLast((request) =>
        JSON.stringify(request.messages).includes("空闲释放后的恢复"),
      )
      .messages.some((message) =>
        JSON.stringify(message.content).includes("验证真实Bash变更记录"),
      ),
  );
  console.log(
    "Claude runtime lifecycle passed: persistent input, steering, background cleanup after result, native goal evaluation completion and usage",
  );
} finally {
  runtime.close();
  await Promise.allSettled([...runtime.queries.values()].map((p) => p.done));
  await service.close();
  await rm(dir, { recursive: true, force: true });
}
