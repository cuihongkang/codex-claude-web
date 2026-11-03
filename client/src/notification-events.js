const labels = {
  completed: "任务已完成",
  failed: "任务失败",
  attention: "需要你确认",
};
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
export function notificationLabel(event) {
  return `${event.provider === "claude" ? "Claude" : "Codex"} · ${labels[event.kind] || "新提醒"}`;
}
export function notificationKey(event) {
  return JSON.stringify([event.provider, event.threadId, event.kind, event.id]);
}
export class NotificationCenter {
  constructor({
    storage,
    hidden,
    deliver,
    changed = () => {},
    now = Date.now,
  }) {
    Object.assign(this, { storage, hidden, deliver, changed, now });
    this.items = [];
    this.enabled = this.read("cx-notifications-enabled", false) === true;
    this.seen = this.read("cx-notifications-seen", {});
  }
  read(key, fallback) {
    try {
      return JSON.parse(this.storage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }
  save(key, value) {
    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch {}
  }
  enable(value) {
    this.enabled = value;
    this.save("cx-notifications-enabled", value);
    if (!value) this.items = [];
    this.changed();
  }
  receive(event) {
    if (
      !event?.threadId ||
      !event.id ||
      !labels[event.kind] ||
      !["codex", "claude"].includes(event.provider)
    )
      return;
    const key = notificationKey(event);
    const seen = { ...this.seen, ...this.read("cx-notifications-seen", {}) };
    if (seen[key]) return;
    seen[key] = this.now();
    this.seen = Object.fromEntries(
      Object.entries(seen)
        .filter(([, t]) => this.now() - t < 86400000)
        .slice(-300),
    );
    this.save("cx-notifications-seen", this.seen);
    if (!this.enabled || !this.hidden()) return;
    this.items = [{ ...event, key }, ...this.items].slice(0, 20);
    this.changed();
    Promise.resolve()
      .then(() => this.deliver(event))
      .catch(() => {});
  }
  dismiss(key) {
    this.items = key ? this.items.filter((item) => item.key !== key) : [];
    this.changed();
  }
}
