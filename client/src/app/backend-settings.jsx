import React, { useState } from "react";
import { useStore, saveBackend, rpc } from "../store.js";
import { CodexModelSettings } from "./codex-model-settings.jsx";
import { ProviderSettings } from "./provider-settings.jsx";
import { ProxySettings } from "./proxy-settings.jsx";

export function BackendSettings() {
  const s = useStore();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function action(run) {
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="backend-settings"
      aria-labelledby="backend-settings-title"
    >
      <h3 id="backend-settings-title">模型与服务配置</h3>
      {s.backends.map((backend) => {
        const cli = backend.installation || {};
        const working = busy || cli.installing;
        return (
          <section className="backend-card" key={backend.id}>
            <div className="backend-heading">
              <input
                type="checkbox"
                aria-label={"启用 " + backend.name}
                checked={backend.enabled}
                disabled={working}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  action(() =>
                    saveBackend({
                      id: backend.id,
                      type: backend.type,
                      enabled,
                    }),
                  );
                }}
              />
              <strong>{backend.name}</strong>
              <span>
                {cli.installed === false
                  ? "未安装"
                  : backend.enabled
                    ? backend.ready
                      ? "已连接"
                      : "连接失败"
                    : "已停用"}
              </span>
              <button
                disabled={working}
                onClick={() =>
                  action(async () => {
                    await rpc("lan/backends/install", { id: backend.id });
                  })
                }
              >
                {cli.installing
                  ? "正在安装…"
                  : cli.installed
                    ? "一键更新"
                    : "一键安装"}
              </button>
            </div>
            <p className="backend-version" role="status">
              当前版本：
              {cli.currentVersion ||
                (cli.checking
                  ? "检测中…"
                  : cli.installed === false
                    ? "未安装"
                    : "暂未取得")}
              {" · 最新版本："}
              {cli.latestVersion || (cli.checking ? "查询中…" : "暂未取得")}
            </p>
            {(cli.installError ||
              cli.latestError ||
              cli.error ||
              backend.error) && (
              <p role="status">
                {cli.installError ||
                  cli.latestError ||
                  cli.error ||
                  backend.error}
              </p>
            )}
            {backend.type === "codex" && (
              <CodexModelSettings backend={backend} />
            )}
            {backend.type === "claude" && (
              <>
                <ProxySettings backend={backend} disabled={working} />
                <ProviderSettings backend={backend} />
              </>
            )}
          </section>
        );
      })}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
