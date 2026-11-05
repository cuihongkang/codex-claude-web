import { isCompacting, mergeCompactions } from "../domain/compaction.js";
import { persist } from "../infrastructure/storage.js";
import { b64decode } from "../domain/format.js";
export function createEvents({
  get,
  set,
  records,
  catalog,
  messages,
  account,
  report,
  notice,
  notifications,
}) {
  function closeTerminal(processId) {
    if (localStorage.getItem("cx-terminal") !== processId) return;
    localStorage.removeItem("cx-terminal");
    set({ terminalOpen: false });
  }
  function handle({ method, params: p = {} }) {
    if (method.startsWith("account/")) {
      account.handle({ method, params: p });
      return;
    }
    if (method === "lan/compaction") {
      if (!records.deletedThreads.has(p.threadId))
        set({
          compactions: mergeCompactions(get().compactions, {
            [p.threadId]: p.compaction,
          }),
        });
      return;
    }
    if (method === "turn/started" || method === "turn/completed")
      records.turnRevisions.set(
        p.threadId,
        (records.turnRevisions.get(p.threadId) || 0) + 1,
      );
    if (method === "thread/reverted") {
      messages.handleReverted(p.threadId);
      return;
    }
    if (method === "thread/deleted") {
      catalog.forgetThread(p.threadId);
      return;
    }
    if (method === "thread/archived") {
      catalog.syncArchivedThread(p.threadId);
      return;
    }
    if (method === "thread/unarchived") {
      catalog.loadThreads().catch(() => {});
      return;
    }
    if (method === "lan/terminalStarted")
      set({
        terminals: {
          ...get().terminals,
          [p.processId]: { buffer: "", running: true },
        },
      });
    if (method === "command/exec/outputDelta" && get().terminals[p.processId]) {
      const t = get().terminals[p.processId];
      set({
        terminals: {
          ...get().terminals,
          [p.processId]: {
            ...t,
            buffer: (t.buffer + b64decode(p.deltaBase64)).slice(-200000),
          },
        },
      });
    }
    if (method === "lan/terminalExit") {
      set({
        terminals: {
          ...get().terminals,
          [p.processId]: { ...get().terminals[p.processId], running: false },
        },
      });
      closeTerminal(p.processId);
    }
    if (
      method === "lan/questionResolved" ||
      method === "serverRequest/resolved"
    ) {
      const id = method === "serverRequest/resolved" ? p.requestId : p.id;
      const request = get().questions.find((q) => String(q.id) === String(id));
      if (request) messages.recordInputRequest(request);
      set({
        questions: get().questions.filter((q) => String(q.id) !== String(id)),
      });
      return;
    }
    if (method === "turn/started") {
      const entry = get().compactions[p.threadId];
      if (entry?.status === "starting" && !entry.turnId)
        set({
          compactions: {
            ...get().compactions,
            [p.threadId]: { ...entry, status: "running", turnId: p.turn.id },
          },
        });
      const turn = {
        ...p.turn,
        startedAt:
          p.turn.startedAt ??
          get().turnTimings[p.threadId]?.[p.turn.id]?.startedAt ??
          Date.now() / 1000,
      };
      records.recordTurnTimings(p.threadId, [turn]);
      records.recordThreadActivity(p.threadId, turn);
      set({ active: { ...get().active, [p.threadId]: p.turn.id } });
    }
    if (method === "turn/completed") {
      const observedTurn = get().active[p.threadId] === p.turn.id;
      account.refreshUsage();
      const entry = get().compactions[p.threadId];
      if (observedTurn && !isCompacting(entry))
        notifications?.completed(p.threadId, p.turn);
      if (isCompacting(entry) && entry.turnId === p.turn.id)
        set({
          compactions: {
            ...get().compactions,
            [p.threadId]: {
              ...entry,
              status:
                p.turn.status === "completed"
                  ? "completed"
                  : p.turn.status === "interrupted"
                    ? "interrupted"
                    : "failed",
              completedAt: p.turn.completedAt ?? Date.now() / 1000,
              error: p.turn.error?.message,
            },
          },
        });
      records.recordTurnTimings(p.threadId, [
        { ...p.turn, completedAt: p.turn.completedAt ?? Date.now() / 1000 },
      ]);
      records.recordThreadActivity(p.threadId, p.turn);
      const active = { ...get().active };
      if (active[p.threadId] === p.turn.id) delete active[p.threadId];
      const unreadCompletions = { ...get().unreadCompletions };
      if (
        observedTurn &&
        p.turn.status === "completed" &&
        !(
          records.readingThreadId === p.threadId &&
          get().current?.id === p.threadId &&
          !get().loading
        )
      )
        unreadCompletions[p.threadId] = p.turn.id;
      set({
        active,
        unreadCompletions,
      });
      if (get().current?.id === p.threadId) {
        if (p.turn.error) report(p.turn.error);
        if (p.turn.status === "interrupted") notice("任务已停止");
        set({
          turns: {
            ...get().turns,
            [p.threadId]: [
              p.turn,
              ...(get().turns[p.threadId] || []).filter(
                (t) => t.id !== p.turn.id,
              ),
            ],
          },
        });
      }
      catalog.loadThreads().catch(() => {});
    }
    if (method === "thread/name/updated") {
      records.updateThreadName(p.threadId, p.threadName ?? p.name ?? null);
    }
    if (method === "thread/tokenUsage/updated")
      set({ tokenUsage: { ...get().tokenUsage, [p.threadId]: p.tokenUsage } });
    if (method === "turn/diff/updated")
      set({
        diffs: { ...get().diffs, [p.threadId]: p.diff },
        turnDiffs: {
          ...get().turnDiffs,
          [p.threadId]: { ...get().turnDiffs[p.threadId], [p.turnId]: p.diff },
        },
      });
    if (method === "lan/files/undone") {
      const undoneFiles = {
        ...get().undoneFiles,
        [JSON.stringify([p.threadId, p.turnId, p.path])]: true,
      };
      persist("cx-undone-files", undoneFiles);
      set({ undoneFiles });
    }
    if (method === "turn/plan/updated")
      set({ plans: { ...get().plans, [p.threadId]: p } });
    if (p.threadId !== get().current?.id) return;
    if (method === "thread/settings/updated")
      set({ serviceTier: p.threadSettings.serviceTier ?? null });
    if (method === "error") report(p.error || p.message || "任务失败");
    if (method === "item/started" || method === "item/completed") {
      if (p.item.type === "contextCompaction") {
        p.item = {
          ...p.item,
          status: method === "item/started" ? "inProgress" : "completed",
        };
        const entry = get().compactions[p.threadId];
        if (isCompacting(entry) && !entry.turnId)
          set({
            compactions: {
              ...get().compactions,
              [p.threadId]: { ...entry, turnId: p.turnId, status: "running" },
            },
          });
      }
      let questionId;
      if (p.item.type === "userMessage") {
        const text = (p.item.content || [])
          .filter((content) => content.type === "text")
          .map((content) => content.text)
          .join("\n");
        questionId = get().items.find(
          (item) =>
            item.optimistic &&
            item.questionId &&
            item.content
              .filter((content) => content.type === "text")
              .map((content) => content.text)
              .join("\n") === text,
        )?.questionId;
        set({ items: get().items.filter((i) => !i.optimistic) });
      }
      messages.put({
        ...p.item,
        turnId: p.turnId,
        ...(questionId ? { questionId } : {}),
      });
    }
    if (method === "item/agentMessage/delta") {
      const i = get().items.find((i) => i.id === p.itemId) || {
        id: p.itemId,
        type: "agentMessage",
        text: "",
        turnId: p.turnId,
      };
      messages.put({ ...i, text: i.text + p.delta });
    }
    if (method === "item/commandExecution/outputDelta") {
      const i = get().items.find((i) => i.id === p.itemId);
      if (i)
        messages.put({
          ...i,
          aggregatedOutput: (i.aggregatedOutput || "") + p.delta,
        });
    }
    if (method === "item/reasoning/summaryTextDelta") {
      const i = get().items.find((i) => i.id === p.itemId) || {
        id: p.itemId,
        type: "reasoning",
        summary: [],
      };
      const summary = [...(i.summary || [])];
      summary[p.summaryIndex] = (summary[p.summaryIndex] || "") + p.delta;
      messages.put({ ...i, summary });
    }
  }
  return { handle, closeTerminal };
}
