import React, { useState } from "react";
import { useStore, setCompletionNotifications } from "../store.js";

export function NotificationSettings() {
  const { notifications: status } = useStore();
  const [busy, setBusy] = useState(false);
  const description = !status.supported
    ? "当前浏览器环境不支持系统通知，请使用支持通知的浏览器并通过受信任的 HTTPS 访问。"
    : status.permission === "denied"
      ? "通知权限已被阻止，请在浏览器的网站设置中允许通知。"
      : "";
  async function update(enabled) {
    setBusy(true);
    try {
      await setCompletionNotifications(enabled);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="notification-settings">
      <label>
        <input
          type="checkbox"
          checked={status.enabled}
          disabled={busy || !status.supported}
          onChange={(event) => update(event.target.checked)}
        />
        对话完成通知
      </label>
      {(busy || (status.enabled && status.permission === "default")) && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => update(true)}
        >
          {busy ? "正在设置…" : "允许系统通知"}
        </button>
      )}
      {description && (
        <p className="section-description" role="status">
          {description}
        </p>
      )}
      {status.error && <p className="inline-error">{status.error}</p>}
    </div>
  );
}
