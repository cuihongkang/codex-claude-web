import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { executionError } from "./execution-errors.mjs";
import { inputMessage, convertMessage } from "./messages.mjs";
import { createExecutionSession } from "./execution-session.mjs";
import { createBackgroundTasks } from "./background-tasks.mjs";
import { createGoals } from "./goals.mjs";
import { modelOptions } from "./model-options.mjs";
import { providerModelEnvironment } from "./provider-environment.mjs";
import { recoverClaudeSessions } from "./recovery.mjs";
import { assertConversationOperation } from "../../bridge/conversation-policy.mjs";

export function createClaudeRuntime({
  backend,
  storage,
  providers,
  broadcast,
  compactions,
  questions,
  observeMessage,
}) {
  const running = new Map();
  const queries = new Map();
  const mutating = new Set();
  const starting = new Map();
  const idleWaiters = new Map();
  let closed = false;
  const emit = (method, params) => broadcast({ method, params });
  async function save(id, change) {
    await storage.update((data) => ({
      ...data,
      sessions: { ...data.sessions, [id]: change(data.sessions[id]) },
    }));
  }
  const tasks = createBackgroundTasks({ storage, save, emit });
  const goals = createGoals({
    storage,
    save,
    emit,
    start: enqueue,
    interrupt,
    running,
    backend,
    queries,
    command,
  });
  async function enqueue(threadId, params, compact = false) {
    if (closed) throw new Error("后端已关闭");
    if (mutating.has(threadId)) throw new Error("正在修改对话历史，请稍后发送");
    const input = compact ? [{ type: "text", text: "/compact" }] : params.input;
    inputMessage(input);
    const turn = {
      id: randomUUID(),
      status: "queued",
      input,
      model: params.model,
      providerId: params.providerId,
      compact,
      mode: params.collaborationMode?.mode || "default",
      effort: params.effort,
      serviceTier: params.serviceTier,
      review: params.review === true,
      goalId: params.goalId,
      createdAt: Date.now() / 1000,
    };
    await save(threadId, (session) => {
      if (!session) throw new Error("对话不存在");
      assertConversationOperation(
        compact ? "thread/compact/start" : "turn/start",
        {
          compacting: compactions.busy(threadId),
          active: running.has(threadId),
          pending: session.queue?.length,
        },
      );
      return { ...session, queue: [...(session.queue || []), turn] };
    });
    if (compact) compactions.start(threadId, turn.id);
    emit("lan/inputQueue/updated", { threadId });
    schedule(threadId);
    return { turn: { id: turn.id, status: "queued", items: [] } };
  }
  function prompt(session, queued) {
    return {
      type: "user",
      uuid: queued.id,
      session_id: session.nativeSessionId || session.id,
      parent_tool_use_id: null,
      message: { role: "user", content: inputMessage(queued.input) },
    };
  }
  async function settle(threadId, result, error) {
    const active = running.get(threadId);
    if (!active) return;
    const turn = active.turn;
    turn.status = active.interrupted
      ? "interrupted"
      : error || result?.is_error || (result && result.subtype !== "success")
        ? "failed"
        : "completed";
    if (turn.status === "failed")
      turn.error = executionError(
        error ||
          new Error(
            (result.errors || [result.result || "Claude 执行失败"]).join("\n"),
          ),
      );
    turn.completedAt = Date.now() / 1000;
    await save(threadId, (s) => ({
      ...s,
      active: null,
      updatedAt: turn.completedAt,
      turns: { ...s.turns, [turn.id]: turn },
      ...(active.queued.compact && {
        compaction: {
          ...s.compaction,
          turnId: turn.id,
          status: turn.status,
          completedAt: turn.completedAt,
          error: turn.error?.message,
        },
      }),
    }));
    await goals.settled(threadId, active, turn);
    for (const [id, q] of questions)
      if (q.threadId === threadId) {
        q.resolve({ behavior: "deny", message: "任务已结束" });
        questions.delete(id);
      }
    running.delete(threadId);
    goals
      .afterSettled(threadId)
      .catch((error) =>
        emit("error", { threadId, error: { message: error.message } }),
      );
    for (const resolve of idleWaiters.get(threadId) || []) resolve();
    idleWaiters.delete(threadId);
    compactions.event("turn/completed", { threadId, turn });
    emit("turn/completed", { threadId, turn });
    schedule(threadId);
  }
  async function drain(threadId) {
    if (running.has(threadId) || closed || mutating.has(threadId)) return;
    const session = (await storage.read()).sessions[threadId];
    if (running.has(threadId)) return;
    const queued = session?.queue?.[0];
    if (!queued || queued.status === "uncertain") return;
    const turn = {
      id: queued.id,
      status: "inProgress",
      startedAt: Date.now() / 1000,
      items: [],
      mode: queued.mode,
    };
    const active = {
      query: null,
      interrupted: false,
      turn,
      queued,
      goalId: queued.goalId,
      inputIds: new Set([queued.id]),
    };
    running.set(threadId, active);
    try {
      await save(threadId, (s) => ({
        ...s,
        queue: s.queue.slice(1),
        active: queued,
        turns: { ...s.turns, [turn.id]: turn },
        updatedAt: turn.startedAt,
        model: queued.model || s.model,
        providerId: queued.providerId ?? s.providerId,
        mode: queued.mode,
        effort: queued.effort,
        serviceTier: queued.serviceTier ?? null,
        name:
          s.name ||
          queued.input
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join(" ")
            .slice(0, 60),
      }));
      emit("turn/started", { threadId, turn });
      emit("thread/settings/updated", {
        threadId,
        threadSettings: {
          model: queued.model || session.model,
          reasoningEffort: queued.effort || "",
          serviceTier: queued.serviceTier ?? null,
          collaborationMode: { mode: queued.mode },
        },
      });
      compactions.event("turn/started", { threadId, turn });
      emit("lan/inputQueue/updated", { threadId });
      let process = queries.get(threadId);
      const provider = await providers.get(
        backend.id,
        queued.providerId ?? session.providerId,
      );
      const options = modelOptions(
        provider,
        queued.model || session.model || provider?.models[0],
        queued,
      );
      if (
        process?.ended ||
        process?.nativeSessionId !== (session.nativeSessionId || threadId) ||
        process?.providerKey !== JSON.stringify(provider) ||
        process?.review !== queued.review
      ) {
        if (
          process &&
          Object.values(session.backgroundTasks || {}).some((task) =>
            ["running", "pending"].includes(task.status),
          )
        )
          throw new Error("请先停止后台任务，再切换供应商或审查模式");
        process?.close();
        queries.delete(threadId);
        process = null;
      }
      if (!process) {
        process = await createExecutionSession({
          backend,
          session,
          queued,
          providers,
          save,
          emit,
          broadcast,
          questions,
          observeMessage,
          goals,
          tasks,
          current: () => running.get(threadId),
          finish: (result) => settle(threadId, result),
          failed: (error) => settle(threadId, null, error),
          beginActivity: (message) => beginActivity(threadId, message),
        });
        Object.assign(process, {
          nativeSessionId: session.nativeSessionId || threadId,
          effort: queued.effort,
          serviceTier: queued.serviceTier,
          review: queued.review,
        });
        queries.set(threadId, process);
      } else {
        await process.query.setPermissionMode(
          queued.mode === "plan" || queued.review
            ? "plan"
            : "bypassPermissions",
        );
        const model = queued.model || session.model;
        if (model && process.model !== model) {
          await process.query.setModel(model);
          process.model = model;
        }
        await process.query.applyFlagSettings({
          effortLevel: queued.effort || null,
          fastMode: options.settings.fastMode,
          ...(provider && {
            env: providerModelEnvironment(
              provider,
              model || process.model,
              queued.effort,
            ),
          }),
        });
        process.effort = queued.effort;
      }
      active.query = process.query;
      await goals.prepare(threadId, process);
      process.lastActivityAt = Date.now();
      const message = prompt(session, queued);
      for (const item of convertMessage(message, turn.id)) {
        turn.items.push(item);
        emit("item/completed", { threadId, turnId: turn.id, item });
      }
      process.input.push(message);
      if (active.interrupted) await interrupt(threadId);
    } catch (error) {
      await settle(threadId, null, error);
    }
  }
  async function beginActivity(threadId, message) {
    if (running.has(threadId) || closed) return;
    const anchor =
      message.event?.message?.id || message.message?.id || message.uuid;
    const turn = {
      id: anchor,
      nativeAnchorId: anchor,
      nativeMessageIds: [anchor, message.uuid],
      automatic: true,
      status: "inProgress",
      startedAt: Date.now() / 1000,
      items: [],
      mode: "default",
    };
    const process = queries.get(threadId);
    running.set(threadId, {
      query: process?.query,
      interrupted: false,
      turn,
      queued: {},
      automatic: true,
      inputIds: new Set(),
    });
    const session = (await storage.read()).sessions[threadId];
    turn.mode = session.mode || "default";
    const active = running.get(threadId);
    if (session.goal?.status === "active") active.goalId = session.goal.id;
    await save(threadId, (s) => ({
      ...s,
      active: { id: anchor, automatic: true },
      turns: { ...s.turns, [anchor]: turn },
      updatedAt: turn.startedAt,
    }));
    emit("turn/started", { threadId, turn });
  }
  function schedule(id) {
    if (starting.has(id) || closed) return;
    const operation = Promise.resolve()
      .then(() => drain(id))
      .catch((error) =>
        emit("error", { threadId: id, error: { message: error.message } }),
      )
      .finally(() => {
        starting.delete(id);
      });
    starting.set(id, operation);
  }
  async function command(id, text) {
    if (running.has(id))
      await new Promise((resolve) => {
        const waiters = idleWaiters.get(id) || new Set();
        waiters.add(resolve);
        idleWaiters.set(id, waiters);
      });
    const process = queries.get(id);
    if (!process || process.ended) return null;
    return process.commands.run(text);
  }
  async function steer(threadId, params) {
    const active = running.get(threadId);
    if (!active || !active.query || active.interrupted)
      throw new Error("当前轮次已结束，请重新发送");
    if (params.expectedTurnId && params.expectedTurnId !== active.turn.id)
      throw new Error("当前轮次已变化，请重新发送");
    assertConversationOperation("turn/steer", {
      compacting: compactions.busy(threadId),
    });
    inputMessage(params.input);
    const session = (await storage.read()).sessions[threadId];
    const queued = { id: randomUUID(), input: params.input };
    active.inputIds.add(queued.id);
    const message = prompt(session, queued);
    message.priority = "now";
    await save(threadId, (s) => ({
      ...s,
      inputTurns: { ...s.inputTurns, [queued.id]: active.turn.id },
      extraItems: {
        ...s.extraItems,
        [queued.id]: {
          id: queued.id,
          type: "userMessage",
          turnId: active.turn.id,
          content: inputMessage(params.input),
        },
      },
    }));
    for (const item of convertMessage(message, active.turn.id)) {
      active.turn.items.push(item);
      emit("item/completed", { threadId, turnId: active.turn.id, item });
    }
    queries.get(threadId).input.push(message);
    queries.get(threadId).lastActivityAt = Date.now();
    return { turnId: active.turn.id };
  }
  async function interrupt(threadId) {
    const active = running.get(threadId);
    if (active) {
      active.interrupted = true;
      const receipt = await active.query?.interrupt({ cancelQueued: true });
      for (const id of receipt?.cancelled || []) active.inputIds.delete(id);
      if (receipt?.cancelled?.length && active.inputIds.size === 0)
        await settle(threadId);
    }
    await save(threadId, (s) => ({
      ...s,
      queue: (s.queue || []).map((q) => ({ ...q, status: "uncertain" })),
    }));
    return {};
  }
  return {
    running,
    queries,
    mutating,
    goals,
    tasks,
    enqueue,
    steer,
    interrupt,
    async check() {
      await mkdir(backend.stateDir, { recursive: true, mode: 0o700 });
      const { stdout } = await promisify(execFile)(
        backend.executable,
        ["--version"],
        { timeout: 10000 },
      );
      return stdout.trim();
    },
    recover: () => recoverClaudeSessions(storage),
    resumeQueue: schedule,
    async releaseUnusedThreads(now = Date.now()) {
      const sessions = (await storage.read()).sessions;
      for (const [id, process] of queries) {
        const session = sessions[id];
        if (
          running.has(id) ||
          starting.has(id) ||
          process.commands?.busy ||
          now - process.lastActivityAt < 300000 ||
          session?.goal?.status === "active" ||
          Object.values(session?.backgroundTasks || {}).some((task) =>
            ["running", "pending"].includes(task.status),
          )
        )
          continue;
        process.close();
        queries.delete(id);
      }
    },
    async releaseSession(id) {
      if (
        running.has(id) ||
        starting.has(id) ||
        queries.get(id)?.commands?.busy
      )
        throw new Error("请等待当前任务结束后修改对话");
      const process = queries.get(id);
      process?.close();
      queries.delete(id);
      await process?.done;
    },
    close() {
      closed = true;
      for (const active of running.values()) active.interrupted = true;
      for (const process of queries.values()) process.close();
    },
  };
}
