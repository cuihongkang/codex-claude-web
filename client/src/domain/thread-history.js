export async function readThreadHistory(
  call,
  threadId,
  { current = () => true, sortDirection = "desc" } = {},
) {
  async function pages(method, params) {
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
      data.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return sortDirection === "desc" ? data.reverse() : data;
  }
  try {
    const records = await pages("thread/items/list", {});
    return records.map(({ item, turnId }) => ({ ...item, turnId }));
  } catch (error) {
    if (!current()) return [];
    if (
      !/thread\/items\/list.*(?:not supported|not implemented)|(?:unknown|unsupported) method|method not found/i.test(
        error.message,
      )
    )
      throw error;
    const turns = await pages("thread/turns/list", { itemsView: "full" });
    return turns.flatMap((turn) =>
      turn.items.map((item) => ({ ...item, turnId: turn.id })),
    );
  }
}
