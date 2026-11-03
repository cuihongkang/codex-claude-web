const labels = {
  completed: "任务已完成",
  failed: "任务失败",
  attention: "需要你确认",
};
export { codexNotification } from "../../server/src/notification-events.mjs";
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
