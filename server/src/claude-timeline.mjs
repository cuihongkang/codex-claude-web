// Preserve transcript order; place replayed/unsaved messages by their original time.
// Identity is the message UUID, never text (users can repeat the same question).
export function mergeClaudeMessages(previous, incoming, removed = []) {
  const map = new Map(previous.map((m) => [m.id, m]));
  for (const id of removed) map.delete(id);
  for (const message of incoming) {
    const old = map.get(message.id);
    const canonical = Number.isFinite(message.historyOrder)
      ? message
      : Number.isFinite(old?.historyOrder)
        ? old
        : null;
    map.set(message.id, {
      ...old,
      ...message,
      kind: canonical?.kind || message.kind || old?.kind,
      timestamp: canonical?.timestamp || message.timestamp || old?.timestamp,
      historyOrder: canonical?.historyOrder,
    });
  }
  const values = [...map.values()];
  const anchors = values
    .filter((m) => Number.isFinite(m.historyOrder))
    .sort((a, b) => a.historyOrder - b.historyOrder);
  let latest = -Infinity;
  const times = anchors.map((m) => {
    const time = Date.parse(m.timestamp);
    if (Number.isFinite(time)) latest = Math.max(latest, time);
    return latest;
  });
  let precedingTime = 0;
  return values
    .map((message, index) => {
      const time = Date.parse(message.timestamp);
      let order = message.historyOrder;
      if (!anchors.length) {
        if (Number.isFinite(time)) precedingTime = time;
        order = precedingTime;
      } else if (!Number.isFinite(order)) {
        order = anchors.at(-1).historyOrder + 1;
        if (Number.isFinite(time)) {
          let low = 0,
            high = anchors.length;
          while (low < high) {
            const mid = (low + high) >>> 1;
            if (times[mid] <= time) low = mid + 1;
            else high = mid;
          }
          order =
            low < anchors.length ? anchors[low].historyOrder - 0.5 : order;
        }
      }
      return { message, index, order, time };
    })
    .sort(
      (a, b) =>
        a.order - b.order ||
        (Number.isFinite(a.time) &&
        Number.isFinite(b.time) &&
        !Number.isFinite(a.message.historyOrder) &&
        !Number.isFinite(b.message.historyOrder)
          ? a.time - b.time
          : 0) ||
        a.index - b.index,
    )
    .map((entry) => entry.message);
}
