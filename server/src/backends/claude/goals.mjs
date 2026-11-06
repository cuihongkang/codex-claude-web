import { createSessionReader } from "./history.mjs";
import { randomUUID } from "node:crypto";

function tokens(usage = {}) {
  return (
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0)
  );
}
function modelTokens(usage = {}) {
  return Object.values(usage).reduce(
    (sum, model) =>
      sum +
      (model.inputTokens || 0) +
      (model.outputTokens || 0) +
      (model.cacheReadInputTokens || 0) +
      (model.cacheCreationInputTokens || 0),
    0,
  );
}
export function createGoals({
  storage,
  save,
  emit,
  start,
  interrupt,
  running,
  backend,
  queries,
  command,
}) {
  const readSession = createSessionReader(backend);
  const read = async (id) => {
    const session = (await storage.read()).sessions[id];
    if (!session) throw new Error("对话不存在");
    return session.goal || null;
  };
  async function change(id, edit) {
    let goal;
    await save(id, (s) => {
      if (!s) throw new Error("对话不存在");
      goal = edit(s.goal || null);
      return { ...s, goal };
    });
    emit("thread/goal/updated", { threadId: id, goal });
    return goal;
  }
  async function set(p) {
    const previous = await read(p.threadId);
    const objective =
      p.objective === undefined ? previous?.objective : p.objective.trim();
    if (!objective) throw new Error("请填写目标");
    if (objective.length > 4000)
      throw new Error("Claude Code 的目标条件最多为 4000 个字符。");
    if (
      ["clear", "stop", "off", "reset", "none", "cancel"].includes(
        objective.toLowerCase(),
      )
    )
      throw new Error("请填写具体的目标完成条件；清除目标请使用清除操作。");
    const budget =
      p.tokenBudget === undefined
        ? (previous?.tokenBudget ?? null)
        : p.tokenBudget;
    if (budget !== null && (!Number.isSafeInteger(budget) || budget <= 0))
      throw new Error("Token 预算须为正整数");
    if (p.status !== undefined && !["active", "paused"].includes(p.status))
      throw new Error("目标状态无效");
    const goal = await change(p.threadId, (old) => ({
      id: old?.id || randomUUID(),
      tokensUsed: old?.tokensUsed || 0,
      timeUsedSeconds: old?.timeUsedSeconds || 0,
      createdAt: old?.createdAt || Date.now() / 1000,
      ...old,
      objective,
      tokenBudget: budget,
      status: p.status || "active",
      origin: p.origin || "user",
      error: null,
      updatedAt: Date.now() / 1000,
    }));
    if (goal.status === "paused") {
      if (running.get(p.threadId)?.goalId === goal.id)
        await interrupt(p.threadId);
      await command(p.threadId, "/goal clear");
    } else {
      if (running.has(p.threadId)) await interrupt(p.threadId);
      await command(p.threadId, "/goal clear");
      await change(p.threadId, (g) => ({ ...g, status: "active" }));
      await kick(p.threadId);
    }
    return { goal: await read(p.threadId) };
  }
  async function kick(id) {
    const goal = await read(id);
    if (goal?.status !== "active") return;
    if (goal.tokenBudget !== null && goal.tokensUsed >= goal.tokenBudget) {
      await change(id, (g) => ({ ...g, status: "budgetLimited" }));
      return;
    }
    const session = (await storage.read()).sessions[id];
    const baseline = session.initialized
      ? await readSession(
          "getNativeGoalStatus",
          session.nativeSessionId || id,
          { dir: session.cwd },
        )
      : null;
    await change(id, (g) => ({
      ...g,
      nativeBaselineId: baseline?.nativeRecordId || null,
    }));
    await start(id, {
      model: session.model,
      providerId: session.providerId,
      effort: session.effort,
      serviceTier: session.serviceTier,
      goalId: goal.id,
      input: [
        {
          type: "text",
          text: `/goal ${goal.objective}`,
        },
      ],
    });
  }
  async function observe(id, message, process) {
    const active = running.get(id);
    if (!active) return;
    let delta = 0;
    let sample;
    if (message.type === "stream_event") {
      process.streamUsage ||= new Map();
      const stream = message.parent_tool_use_id || "main";
      if (message.event.type === "message_start") {
        process.streamUsage.set(stream, {
          id: message.event.message.id,
          usage: message.event.message.usage,
        });
      }
      sample = process.streamUsage.get(stream);
      if (message.event.type === "message_delta" && sample)
        sample.usage = { ...sample.usage, ...message.event.usage };
    }
    if (message.type === "assistant" && !message.isReplay)
      sample = {
        id: message.message?.id || message.uuid,
        usage: message.message?.usage,
      };
    if (sample) {
      const key = sample.id;
      process.observed ||= new Map();
      const total = Math.max(
        tokens(sample.usage),
        process.observed.get(key) || 0,
      );
      delta = total - (process.observed.get(key) || 0);
      process.observed.set(key, total);
      active.observedTokens = (active.observedTokens || 0) + delta;
    }
    if (message.type === "result") {
      const cumulative = modelTokens(message.modelUsage);
      const actual = cumulative - (process.modelTokens || 0);
      process.modelTokens = cumulative;
      delta =
        Math.max(active.observedTokens || 0, actual) -
        (active.observedTokens || 0);
      await save(id, (s) => ({ ...s, modelTokens: cumulative }));
    }
    if (!delta) return;
    let exhausted = false;
    await change(id, (goal) => {
      if (!goal || (goal.status !== "active" && active.goalId !== goal.id))
        return goal;
      const used = Math.max(0, goal.tokensUsed + delta);
      exhausted =
        goal.status === "active" &&
        goal.tokenBudget !== null &&
        used >= goal.tokenBudget;
      return {
        ...goal,
        tokensUsed: used,
        status: exhausted ? "budgetLimited" : goal.status,
      };
    });
    if (exhausted && message.type !== "result") await interrupt(id);
  }
  async function beforeTool(id) {
    const goal = await read(id);
    if (goal?.status !== "budgetLimited" || running.get(id)?.goalId !== goal.id)
      return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "目标的 Token 预算已达上限，请等待用户调整预算。",
      },
    };
  }
  async function prepare(id, process) {
    const goal = await read(id);
    if (goal?.status === "active") return;
    const listing = await process.query.getHooksListing();
    if (
      listing.hooks.some(
        (hook) =>
          hook.event === "Stop" &&
          hook.source === "sessionHook" &&
          hook.type === "prompt",
      )
    )
      await process.commands.run("/goal clear");
  }
  async function synchronize(id) {
    const goal = await read(id);
    if (goal?.status !== "active") return goal;
    const process = queries.get(id);
    if (!process || process.ended) return goal;
    const listing = await process.query.getHooksListing();
    const present = listing.hooks.some(
      (hook) =>
        hook.event === "Stop" &&
        hook.source === "sessionHook" &&
        hook.type === "prompt",
    );
    const session = (await storage.read()).sessions[id];
    const native = await readSession(
      "getNativeGoalStatus",
      session.nativeSessionId || id,
      { dir: session.cwd },
    );
    const current =
      native?.condition === goal.objective &&
      native?.nativeRecordId !== goal.nativeBaselineId;
    const backgroundRunning = Object.values(session.backgroundTasks || {}).some(
      (task) => ["running", "pending"].includes(task.status),
    );
    if (present && backgroundRunning)
      return change(id, (g) => ({
        ...g,
        nativeStatus: native,
        lastCheckedAt: Date.now() / 1000,
      }));
    return change(id, (g) => ({
      ...g,
      status:
        present || (current && native?.failed)
          ? "blocked"
          : current && native?.met && !native.sentinel
            ? "complete"
            : "blocked",
      nativeStatus: native,
      ...(present && {
        error: {
          message:
            native?.evaluationError?.stderr ||
            native?.evaluationError?.content ||
            native?.reason ||
            "目标检查未完成，请继续执行以重新检查目标。",
        },
      }),
      updatedAt: Date.now() / 1000,
    }));
  }
  async function settled(id, active, turn) {
    await change(id, (goal) => {
      if (!goal || (goal.status !== "active" && active.goalId !== goal.id))
        return goal;
      const status =
        turn.status === "failed" && goal.status === "active"
          ? "blocked"
          : turn.status === "interrupted" && goal.status === "active"
            ? "paused"
            : goal.status;
      return {
        ...goal,
        status,
        timeUsedSeconds:
          goal.timeUsedSeconds + Math.max(0, turn.completedAt - turn.startedAt),
      };
    });
    if (turn.status === "completed") await synchronize(id);
  }
  return {
    read,
    prepare,
    synchronize,
    kick,
    observe,
    beforeTool,
    settled,
    async afterSettled(id) {
      if (
        ["budgetLimited", "paused", "blocked"].includes(
          (await read(id))?.status,
        )
      )
        await command(id, "/goal clear");
    },
    handlers: new Map([
      ["thread/goal/get", async (p) => ({ goal: await read(p.threadId) })],
      ["thread/goal/set", set],
      [
        "thread/goal/clear",
        async (p) => {
          const goal = await read(p.threadId);
          await change(p.threadId, () => null);
          if (goal && running.get(p.threadId)?.goalId === goal.id)
            await interrupt(p.threadId);
          await command(p.threadId, "/goal clear");
          return { goal: null };
        },
      ],
    ]),
  };
}
