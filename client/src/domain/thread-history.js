export async function readThreadHistory(
  call,
  threadId,
  { current = () => true, sortDirection = "desc", onFirstPage } = {},
) {
  async function pages(method, params, messages) {
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
      if (!cursor && onFirstPage) {
        const first =
          sortDirection === "desc" ? page.data.toReversed() : page.data;
        onFirstPage(messages(first));
      }
      data.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return sortDirection === "desc" ? data.reverse() : data;
  }
  try {
    const messages = (records) =>
      records.map(({ item, turnId }) => ({ ...item, turnId }));
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
