import React, { useSyncExternalStore } from "react";
import {
  center,
  notificationSnapshot,
  subscribeNotifications,
  enableNotifications,
  openNotification,
} from "./notifications.js";
import { notificationLabel } from "./notification-events.js";
const useNotifications = () =>
  useSyncExternalStore(subscribeNotifications, notificationSnapshot);
export function NotificationSettings() {
  const s = useNotifications();
  return (
    <section className="claude-notification-settings">
      <h3>Claude 消息提醒</h3>
      <label>
        <input
          type="checkbox"
          checked={s.enabled}
          onChange={(e) =>
            e.target.checked ? enableNotifications() : center.enable(false)
          }
        />{" "}
        离开标签页时提醒我
      </label>
      <p className="section-description">
        Claude 的任务完成、失败或需要确认时提醒。手机后台提醒继续使用 ntfy。
      </p>
      <p className="section-description" role="status">
        {s.permission === "unavailable"
          ? "当前地址或浏览器不支持系统通知，仍可使用页内和标签标题提醒。系统通知需要 HTTPS 或 localhost。"
          : s.permission === "denied"
            ? "系统通知已被浏览器阻止；可在网站权限中允许。页内和标签标题提醒仍可用。"
            : s.permission === "granted"
              ? "系统通知已获授权。手机浏览器被挂起时可能无法及时提醒。"
              : "开启后可授权浏览器系统通知。"}
      </p>
    </section>
  );
}
export function NotificationInbox() {
  const s = useNotifications();
  if (!s.items.length) return null;
  return (
    <aside className="notification-inbox" aria-label="消息提醒">
      <details>
        <summary>{s.items.length} 条消息提醒</summary>
        {s.items.map((item) => (
          <button key={item.key} onClick={() => openNotification(item)}>
            <strong>{notificationLabel(item)}</strong>
            <span>{item.title || "打开会话"}</span>
          </button>
        ))}
        <button onClick={() => center.dismiss()}>清除提醒</button>
      </details>
    </aside>
  );
}
