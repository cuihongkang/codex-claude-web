export async function readThreadHistory(
  call,
  threadId,
  { current = () => true, sortDirection = "desc", onFirstPage } = {},
) {
  async function pages(method, params, messages, firstPage = onFirstPage) {
    const data = [];
    let cursor;
    do {
      const page = await call(method, {
        threadId,
        limit: 100,
        sortDirection,
        ...params,
        ...(cursor ? { cursor } : {}),
      });
      if (!current()) return [];
      if (!cursor && firstPage) {
        const first =
          sortDirection === "desc" ? page.data.toReversed() : page.data;
        firstPage(messages(first));
      }
      data.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return sortDirection === "desc" ? data.reverse() : data;
  }
  const turnMessages = (turns) =>
    turns.flatMap((turn) =>
      turn.items.map((item) => ({ ...item, turnId: turn.id })),
    );
  try {
    const messages = (records) =>
      records.map(({ item, turnId }) => ({ ...item, turnId }));
    if (onFirstPage) {
      const page = await call("thread/items/list", {
        threadId,
        limit: 100,
        sortDirection,
      });
      if (!current()) return [];
      const first =
        sortDirection === "desc" ? page.data.toReversed() : page.data;
      onFirstPage(messages(first));
      if (!page.nextCursor) return messages(first);
      if (new Set(page.data.map((record) => record.turnId)).size > 1) {
        const older = [];
        let cursor = page.nextCursor;
        while (cursor) {
          const next = await call("thread/items/list", {
            threadId,
            limit: 100,
            sortDirection,
            cursor,
          });
          if (!current()) return [];
          older.push(...next.data);
          cursor = next.nextCursor;
        }
        return messages(
          sortDirection === "desc"
            ? [...page.data, ...older].reverse()
            : [...page.data, ...older],
        );
      }
      // 消息分页原生上限为 100；首屏后按完整轮次恢复，减少长历史的串行往返。
      return turnMessages(
        await pages(
          "thread/turns/list",
          { itemsView: "full", limit: 1 },
          turnMessages,
          null,
        ),
      );
    }
    return messages(await pages("thread/items/list", {}, messages));
  } catch (error) {
    if (!current()) return [];
    if (
      !/thread\/items\/list.*(?:not supported|not implemented)|(?:unknown|unsupported) method|method not found/i.test(
        error.message,
      )
    )
      throw error;
    const messages = (turns) =>
      turns.flatMap((turn) =>
        turn.items.map((item) => ({ ...item, turnId: turn.id })),
      );
    return messages(
      await pages("thread/turns/list", { itemsView: "full" }, messages),
    );
  }
}
