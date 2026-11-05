// 编辑重发先替换后端历史；保留编辑会话的回退结果，使发送失败可直接重试。
export function createMessageEditing({ get, set, rpc, navigation }) {
  const reverting = new Set();
  async function prepare(edit) {
    const { threadId, item } = edit;
    const epoch = navigation.opening;
    const current = () =>
      get().connected &&
      get().current?.id === threadId &&
      navigation.opening === epoch;
    function check() {
      if (!current())
        throw new Error("对话已切换或连接已中断，请重新打开消息后编辑。");
      if (get().active[threadId])
        throw new Error("请等待当前任务结束后编辑消息。");
    }
    check();
    const turns = [];
    let cursor;
    do {
      const page = await rpc("thread/turns/list", {
        threadId,
        limit: 100,
        sortDirection: "asc",
        itemsView: "full",
        ...(cursor ? { cursor } : {}),
      });
      check();
      turns.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    if (turns.some((turn) => turn.status === "inProgress"))
      throw new Error("请等待当前任务结束后编辑消息。");
    if (edit.retainedIds) {
      if (JSON.stringify(turns.map((turn) => turn.id)) !== edit.retainedIds)
        throw new Error("对话已有新消息，请重新打开对话后编辑。");
      return;
    }
    const index = turns.findIndex((turn) => turn.id === item.turnId);
    const users = turns.flatMap((turn) =>
      (turn.items || []).filter((entry) => entry.type === "userMessage"),
    );
    if (
      index < 0 ||
      users.at(-1)?.id !== item.id ||
      turns[index].items.find((entry) => entry.type === "userMessage")?.id !==
        item.id
    )
      throw new Error("仅可编辑最近一轮的初始消息，请重新打开对话核对历史。");
    navigation.invalidateHistory();
    reverting.add(threadId);
    try {
      await rpc("thread/revert", { threadId, beforeTurnId: item.turnId });
    } catch (error) {
      if (
        !/(?:unknown|unsupported) method|method not found|thread\/revert.*(?:not supported|not implemented)/i.test(
          error.message,
        )
      )
        throw error;
      check();
      await rpc("thread/rollback", {
        threadId,
        numTurns: turns.length - index,
      });
    }
    const retained = turns.slice(0, index);
    edit.retainedIds = JSON.stringify(retained.map((turn) => turn.id));
    if (!current()) throw new Error("消息历史已更新，请返回原对话重新发送。");
    const retainedIds = new Set(retained.map((turn) => turn.id));
    const keep = (values) =>
      Object.fromEntries(
        Object.entries(values || {}).filter(([id]) => retainedIds.has(id)),
      );
    set({
      items: [
        ...retained.flatMap((turn) =>
          turn.items.map((entry) => ({ ...entry, turnId: turn.id })),
        ),
        item,
      ],
      turns: { ...get().turns, [threadId]: retained },
      turnTimings: {
        ...get().turnTimings,
        [threadId]: keep(get().turnTimings[threadId]),
      },
      turnDiffs: {
        ...get().turnDiffs,
        [threadId]: keep(get().turnDiffs[threadId]),
      },
      diffs: { ...get().diffs, [threadId]: "" },
      plans: { ...get().plans, [threadId]: null },
    });
  }
  function finish(edit) {
    if (get().current?.id === edit.threadId)
      set({ items: get().items.filter((item) => item.id !== edit.item.id) });
  }
  function release(edit) {
    reverting.delete(edit.threadId);
  }
  function handleReverted(threadId) {
    if (!reverting.has(threadId) && get().current?.id === threadId)
      navigation.openThread(threadId, { preserveServiceTier: true });
  }
  return { prepare, finish, release, handleReverted };
}
