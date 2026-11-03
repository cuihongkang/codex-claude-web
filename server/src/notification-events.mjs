export function codexNotification(message) {
  const { method, params: p = {} } = message;
  if (!p.threadId) return null;
  let kind, id;
  if (
    method === "turn/completed" &&
    ["completed", "failed"].includes(p.turn?.status)
  ) {
    kind = p.turn.status;
    id = p.turn.id;
  } else if (
    message.id !== undefined &&
    /(?:requestUserInput|requestApproval)$/.test(method || "")
  ) {
    kind = "attention";
    id = `request:${message.id}`;
  } else if (
    ["item/started", "item/completed"].includes(method) &&
    p.item?.questions?.length
  ) {
    kind = "attention";
    id = `question:${p.item.id}`;
  }
  return kind && id
    ? { provider: "codex", threadId: p.threadId, kind, id }
    : null;
}
