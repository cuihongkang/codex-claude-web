import {
  NotificationCenter,
  notificationKey,
  notificationLabel,
} from "./notification-events.js";
const listeners = new Set();
const browserDocument = globalThis.document;
const baseTitle = browserDocument?.title || "Codex Web";
let snapshot, worker;
const systemAvailable = () =>
  globalThis.window?.isSecureContext && !!window.Notification;
function changed() {
  snapshot = {
    enabled: center.enabled,
    items: center.items,
    permission: systemAvailable() ? Notification.permission : "unavailable",
  };
  if (browserDocument)
    browserDocument.title = center.items.length
      ? `(${center.items.length} 条提醒) ${baseTitle}`
      : baseTitle;
  for (const listener of listeners) listener();
}
export function openNotification(event) {
  window.focus();
  center.dismiss(notificationKey(event));
  window.dispatchEvent(
    new CustomEvent("codex-web:notification", { detail: event }),
  );
}
async function deliver(event) {
  if (!systemAvailable() || Notification.permission !== "granted") return;
  const options = {
    body: event.title || "点击返回会话",
    tag: notificationKey(event),
    icon: "/favicon.png",
    data: event,
  };
  try {
    if (navigator.serviceWorker) {
      worker ||= navigator.serviceWorker
        .register("/claude-notification-worker.js", {
          scope: "/claude-notifications/",
        })
        .catch((error) => {
          worker = null;
          throw error;
        });
      const registration = await worker;
      if (!registration.active) {
        const installing = registration.installing || registration.waiting;
        await new Promise((resolve, reject) => {
          if (!installing) return reject(new Error("通知服务尚未就绪"));
          const changed = () => {
            if (
              installing.state === "activated" ||
              installing.state === "redundant"
            ) {
              installing.removeEventListener("statechange", changed);
              installing.state === "activated"
                ? resolve()
                : reject(new Error("通知服务未启动"));
            }
          };
          installing.addEventListener("statechange", changed);
          changed();
        });
      }
      await registration.showNotification(notificationLabel(event), options);
      return;
    }
  } catch {}
  const notification = new Notification(notificationLabel(event), options);
  notification.onclick = () => {
    notification.close();
    openNotification(event);
  };
}
let storage;
try {
  storage = localStorage;
} catch {}
export const center = new NotificationCenter({
  storage,
  hidden: () => browserDocument?.visibilityState === "hidden",
  deliver,
  changed,
});
changed();
export const notificationSnapshot = () => snapshot;
export const subscribeNotifications = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export async function enableNotifications() {
  center.enable(true);
  if (systemAvailable() && Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {}
  }
  changed();
}
export function receiveNotification(event) {
  // Serialize cross-tab claims when supported; the shared event IDs also suppress reconnect replays.
  if (navigator.locks)
    navigator.locks
      .request("codex-web-notifications", () => center.receive(event))
      .catch(() => center.receive(event));
  else center.receive(event);
}
globalThis.window?.addEventListener("focus", changed);
globalThis.window?.addEventListener("storage", (event) => {
  if (event.key === "cx-notifications-enabled") {
    center.enabled = center.read(event.key, false) === true;
    if (!center.enabled) center.items = [];
    changed();
  }
});
globalThis.navigator?.serviceWorker?.addEventListener("message", (event) => {
  if (event.data?.type === "codex-web:notification")
    openNotification(event.data.event);
});
