import { saved, persist } from "./storage.js";
import { claimCompletion } from "./notification-claims.js";

export const notificationPreference = "cx-completion-notifications";

export function createBrowserNotifications() {
  function status() {
    const supported = Boolean(
      globalThis.isSecureContext &&
      window.Notification &&
      navigator.serviceWorker &&
      window.indexedDB,
    );
    return {
      supported,
      enabled: saved(notificationPreference, true) === true,
      permission: supported ? Notification.permission : "unsupported",
    };
  }
  async function worker() {
    const registration = await navigator.serviceWorker.register(
      "/notification-worker.js",
    );
    if (registration.active) return registration.active;
    return new Promise((resolve, reject) => {
      const installing = registration.installing || registration.waiting;
      const cleanup = () => {
        clearTimeout(timer);
        installing?.removeEventListener("statechange", check);
      };
      const check = () => {
        if (registration.active) {
          cleanup();
          resolve(registration.active);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("通知服务启动超时，请重试。"));
      }, 10000);
      installing?.addEventListener("statechange", check);
      check();
    });
  }
  async function enable() {
    if (!status().supported) throw new Error("当前浏览器环境不支持系统通知。");
    persist(notificationPreference, true);
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;
    await worker();
    return true;
  }
  function disable() {
    persist(notificationPreference, false);
  }
  async function show({ key, title, threadId, username, current }) {
    const target = await worker();
    if (!current() || !(await claimCompletion(key)) || !current()) return;
    await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        channel.port1.close();
        reject(new Error("发送通知超时，请检查浏览器通知设置。"));
      }, 10000);
      channel.port1.onmessage = ({ data }) => {
        clearTimeout(timer);
        channel.port1.close();
        if (data.error) reject(new Error(data.error));
        else resolve();
      };
      target.postMessage(
        {
          type: "completion-notification",
          title,
          options: {
            body: "本轮任务已完成",
            icon: "/favicon.png",
            tag: key,
            data: { threadId, username },
          },
        },
        [channel.port2],
      );
    });
  }
  function listen({ refresh, open }) {
    const message = ({ data }) => {
      if (data?.type === "open-notification-thread") open(data);
    };
    const storage = (event) => {
      if (event.key === notificationPreference || event.key === null) refresh();
    };
    const focus = () => refresh();
    window.addEventListener("storage", storage);
    window.addEventListener("focus", focus);
    navigator.serviceWorker?.addEventListener("message", message);
    let permission;
    let disposed = false;
    navigator.permissions?.query({ name: "notifications" }).then(
      (result) => {
        if (disposed) return;
        permission = result;
        permission.addEventListener("change", refresh);
      },
      () => {},
    );
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has("notificationThread")) {
      open({
        threadId: params.get("notificationThread"),
        username: params.get("notificationUser"),
      });
      history.replaceState(null, "", location.pathname + location.search);
    }
    return () => {
      disposed = true;
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", focus);
      navigator.serviceWorker?.removeEventListener("message", message);
      permission?.removeEventListener("change", refresh);
    };
  }
  return { status, enable, disable, show, listen };
}
