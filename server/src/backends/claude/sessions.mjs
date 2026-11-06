import { recoverAgents, agentTurns } from "./agent-history.mjs";
import { randomUUID } from "node:crypto";
import {
  createHistoryActions,
  forkHistory,
  retainedDetails,
} from "./history-actions.mjs";
import { page } from "./history.mjs";
import { historyTurns, visibleSessionMessages } from "./messages.mjs";
import { conversationMethods } from "../../../../shared/product-contract.mjs";

export function createClaudeSessions({
  config,
  storage,
  readSession,
  runtime,
  compactions,
  notify,
  assertReady,
  readTokenUsage = async (session) => session.tokenUsage,
}) {
  runtime.mutating ||= new Set();
  async function update(id, patch) {
    await storage.update((data) => ({
      ...data,
      sessions: { ...data.sessions, [id]: { ...data.sessions[id], ...patch } },
    }));
  }
  async function session(id) {
    const data = await storage.read();
    if (id?.startsWith("agent/")) {
      const [, parentId] = id.split("/");
      const parent = data.sessions[parentId];
      if (!parent || parent.deleted) throw new Error("对话不存在");
      let agent = parent.agents?.[id];
      if (!agent && parent.initialized) {
        await turns(parentId);
        agent = (await storage.read()).sessions[parentId].agents?.[id];
      }
      if (agent)
        return {
          ...parent,
          id,
          name: agent.name,
          parentId,
          parentNativeId:
            agent.parentNativeId || parent.nativeSessionId || parentId,
          agentId: agent.agentId,
          turns: {},
          turnIds: {},
          extraItems: {},
        };
    }
    const value = data.sessions[id];
    if (!value || value.deleted) throw new Error("对话不存在");
    return value;
  }
  function thread(s) {
    return {
      ...s,
      queue: undefined,
      turns: undefined,
      active: undefined,
      status: { type: runtime.running.has(s.id) ? "active" : "idle" },
      path: s.archived ? "/archived_sessions/" : "",
      preview: s.name || "新对话",
    };
  }
  async function turns(id) {
    const s = await session(id);
    const messages = s.agentId
      ? await readSession(
          "getSubagentMessages",
          s.parentNativeId || s.parentId,
          s.agentId,
          {
            dir: s.cwd,
          },
        )
      : s.initialized
        ? await readSession("getSessionMessages", s.nativeSessionId || id, {
            dir: s.cwd,
            includeSystemMessages: true,
          })
        : [];
    if (s.agentId) return agentTurns(messages);
    const records = historyTurns(
      visibleSessionMessages(messages, s.internalInputIds),
      s.turns,
      s.turnIds,
      s.inputTurns,
    );
    for (const saved of Object.values(s.turns || {}))
      if (!records.some((t) => t.id === saved.id) && saved.items?.length)
        records.push(saved);
    for (const item of Object.values(s.extraItems || {})) {
      const turn = records.find((t) => t.id === item.turnId);
      if (turn && !turn.items.some((i) => i.id === item.id))
        turn.items.push(item);
    }
    if (s.initialized) {
      const agents = await recoverAgents(
        { ...s, running: runtime.running.has(s.id) },
        records,
        readSession,
      );
      await storage.update((data) => {
        const current = data.sessions[s.id];
        if (current?.deleted || current?.nativeSessionId !== s.nativeSessionId)
          return data;
        return {
          ...data,
          sessions: {
            ...data.sessions,
            [s.id]: { ...current, agents: { ...agents, ...current.agents } },
          },
        };
      });
    }
    return records;
  }
  const revert = createHistoryActions({
    session,
    turns,
    update,
    readSession,
    running: runtime.running,
    compactions,
    notify,
  });

  const methods = new Set([...conversationMethods, "lan/agents/messages"]);
  async function perform(method, p) {
    if (method === "lan/agents/messages")
      return {
        messages: (await turns(p.threadId)).flatMap((turn) =>
          turn.items.filter(
            (item) => item.type === "userMessage" && item.authorLabel,
          ),
        ),
      };
    if (["thread/revert", "thread/rollback"].includes(method)) return revert(p);
    if (method === "thread/list") {
      const data = await storage.read();
      const native = await readSession("listSessions", {});
      const aliases = new Set(
        Object.values(data.sessions).flatMap((s) => [
          s.id,
          s.nativeSessionId,
          ...(s.nativeAliases || []),
        ]),
      );
      for (const n of native)
        if (!aliases.has(n.sessionId))
          data.sessions[n.sessionId] = {
            id: n.sessionId,
            name: n.customTitle || n.summary,
            cwd: n.cwd,
            createdAt: (n.createdAt || n.lastModified) / 1000,
            updatedAt: n.lastModified / 1000,
            initialized: true,
            turns: {},
            queue: [],
          };
      const merged = await storage.update((current) => ({
        ...current,
        sessions: { ...data.sessions, ...current.sessions },
      }));
      return page(
        Object.values(merged.sessions)
          .filter(
            (s) =>
              !s.deleted &&
              Boolean(s.archived) === Boolean(p.archived) &&
              (!p.searchTerm || s.name?.includes(p.searchTerm)),
          )
          .sort((a, b) => a.updatedAt - b.updatedAt)
          .map(thread),
        p,
      );
    }
    if (method === "thread/start") {
      assertReady();
      const id = randomUUID(),
        now = Date.now() / 1000;
      const s = {
        id,
        cwd: p.cwd || config.defaultCwd,
        model: p.model,
        serviceTier: p.serviceTier ?? null,
        providerId: p.providerId ?? "",
        threadSource: p.threadSource,
        createdAt: now,
        updatedAt: now,
        initialized: false,
        turns: {},
        queue: [],
      };
      await update(id, s);
      return { thread: thread(s), model: s.model, cwd: s.cwd };
    }
    if (method === "thread/unsubscribe") return { status: "unsubscribed" };
    if (["thread/read", "thread/resume"].includes(method)) {
      const s = await session(p.threadId);
      return {
        thread: {
          ...thread(s),
          tokenUsage: await readTokenUsage(s),
          ...(p.includeTurns && { turns: await turns(s.id) }),
        },
        cwd: s.cwd,
        model: s.model,
        reasoningEffort: s.effort || "",
        collaborationMode: { mode: s.mode || "default" },
        serviceTier: s.serviceTier ?? null,
      };
    }
    if (method === "thread/turns/list") return page(await turns(p.threadId), p);
    if (method === "thread/items/list")
      return page(
        (await turns(p.threadId)).flatMap((turn) =>
          (turn.items || []).map((item) => ({ turnId: turn.id, item })),
        ),
        p,
      );
    if (
      [
        "thread/name/set",
        "thread/archive",
        "thread/unarchive",
        "thread/delete",
        "thread/fork",
      ].includes(method)
    ) {
      const s = await session(p.threadId);
      if (runtime.running.has(s.id)) throw new Error("请等待此对话任务结束");
      if (method === "thread/fork") {
        if (!s.initialized) throw new Error("请在首轮完成后创建分支");
        const records = await turns(s.id);
        const index = p.lastTurnId
          ? records.findIndex((turn) => turn.id === p.lastTurnId)
          : records.length - 1;
        if (index < 0) throw new Error("分支起点已变化，请刷新历史后重试");
        const retained = records.slice(0, index + 1);
        const fork = await forkHistory(readSession, s, retained);
        const sessionId = fork.nativeSessionId;
        const copy = {
          ...s,
          id: sessionId,
          ...fork,
          nativeAliases: [sessionId],
          forkedFromId: s.id,
          queue: [],
          active: null,
          turns: Object.fromEntries(
            retained.map((turn) => [
              turn.id,
              { ...turn, ...fork.historyAnchors?.[turn.id] },
            ]),
          ),
          ...retainedDetails(await session(s.id), retained, sessionId),
          archived: false,
          createdAt: Date.now() / 1000,
          updatedAt: Date.now() / 1000,
        };
        await update(sessionId, copy);
        return { thread: thread(copy) };
      }
      if (method === "thread/name/set") {
        if (typeof p.name !== "string" || !p.name.trim())
          throw new Error("请输入对话名称");
        p = { ...p, name: p.name.trim() };
        if (s.initialized)
          await readSession(
            "renameSession",
            s.nativeSessionId || s.id,
            p.name,
            { dir: s.cwd },
          );
        await update(s.id, { name: p.name });
        notify("thread/name/updated", { threadId: s.id, threadName: p.name });
      } else {
        const deleted = method === "thread/delete";
        if (deleted && s.initialized)
          await readSession("deleteSession", s.nativeSessionId || s.id, {
            dir: s.cwd,
          });
        await update(
          s.id,
          deleted
            ? { deleted: true }
            : { archived: method === "thread/archive" },
        );
        notify(
          deleted
            ? "thread/deleted"
            : method === "thread/archive"
              ? "thread/archived"
              : "thread/unarchived",
          { threadId: s.id },
        );
      }
      return {};
    }

    throw new Error(`未知对话操作：${method}`);
  }
  const mutations = new Set([
    "thread/revert",
    "thread/rollback",
    "thread/fork",
    "thread/name/set",
    "thread/archive",
    "thread/unarchive",
    "thread/delete",
  ]);
  const operations = new Map();
  async function request(method, p) {
    if (method === "thread/list")
      await Promise.allSettled([...operations.values()]);
    if (!mutations.has(method)) return perform(method, p);
    const id = p.threadId;
    if (runtime.mutating.has(id)) throw new Error("正在更新此对话，请稍候");
    runtime.mutating.add(id);
    const operation = (async () => {
      const s = await session(id);
      if (runtime.running.has(id) || s.queue?.length || compactions.busy(id))
        throw new Error("请等待此对话任务结束");
      await runtime.releaseSession?.(id);
      return perform(method, p);
    })();
    operations.set(id, operation);
    try {
      return await operation;
    } finally {
      runtime.mutating.delete(id);
      operations.delete(id);
    }
  }
  return {
    request,
    handles: (method) => methods.has(method),
    session,
    turns,
    update,
  };
}
