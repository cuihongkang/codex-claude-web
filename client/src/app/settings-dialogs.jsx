import { NotificationSettings as ClaudeNotificationSettings } from "../notifications.jsx";
import React from "react";
import { Check, Sun, Moon, Monitor } from "lucide-react";
import { useStore, set, selectModel, setTheme } from "../store.js";
import { ServiceTierToggle } from "../features/composer/service-tier-toggle.jsx";
import { ReasoningEffortControl } from "../features/composer/reasoning-effort.jsx";
import { VersionDetails } from "./version.jsx";
import { LogoutButton } from "./auth.jsx";
import { NotificationSettings } from "./notification-settings.jsx";
export function SettingsDialog() {
  const s = useStore();
  return (
    <div className="settings-body">
      <h3>网页登录</h3>
      <LogoutButton />
      <h3>通知</h3>
      <NotificationSettings />
      <h3>外观</h3>
      <div className="theme-options">
        {[
          ["light", Sun, "浅色"],
          ["dark", Moon, "深色"],
          ["system", Monitor, "跟随系统"],
        ].map(([v, Icon, label]) => (
          <button
            key={v}
            className={s.theme === v ? "selected" : ""}
            onClick={() => setTheme(v)}
          >
            <Icon size={21} />
            {label}
            {s.theme === v && <Check size={14} />}
          </button>
        ))}
      </div>
      <ClaudeNotificationSettings />
      <h3>快捷键</h3>
      <div className="shortcut-list">
        <span>
          搜索对话<kbd>Ctrl / ⌘ K</kbd>
        </span>
        <span>
          新对话<kbd>Ctrl / ⌘ Shift O</kbd>
        </span>
        <span>
          显示终端<kbd>Ctrl / ⌘ `</kbd>
        </span>
        <span>
          消息换行<kbd>Enter</kbd>
        </span>
      </div>
      <h3>关于</h3>
      <VersionDetails />
    </div>
  );
}
export function ModelDialog() {
  const s = useStore();
  return (
    <div className="settings-body">
      <p className="section-description">设置应用于下一条消息。</p>
      <div className="model-options">
        {s.models.map((m) => (
          <button
            key={m.id}
            className={m.model === s.model ? "selected" : ""}
            onClick={() => selectModel(m)}
          >
            <span>
              <b>{m.displayName || m.model}</b>
              <small>{m.description}</small>
            </span>
            {m.model === s.model && <Check size={17} />}
          </button>
        ))}
      </div>
      <ReasoningEffortControl inline />
      <h3>速度模式</h3>
      <ServiceTierToggle />
      <p className="section-description">Fast 模式会增加用量。</p>
      <div className="dialog-done">
        <button className="primary" onClick={() => set({ modal: null })}>
          完成
        </button>
      </div>
    </div>
  );
}
