import React, { useState } from "react";
import { useStore, saveBackend, rpc, refreshBackends } from "../store.js";
import { ProviderSettings } from "./provider-settings.jsx";

export function BackendSettings() {
  const s = useStore();
  const [editing, setEditing] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function action(run) {
    setBusy(true);
    setError("");
    try {
      await run();
      setEditing(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="backend-settings">
      <summary>模型与服务配置</summary>
      {s.backends.map((backend) => (
        <section className="backend-card" key={backend.id}>
          <div className="backend-heading">
            <strong>{backend.name}</strong>
            <span>
              {backend.enabled
                ? backend.ready
                  ? "已连接"
                  : "连接失败"
                : "已停用"}
            </span>
            <button disabled={busy} onClick={() => setEditing(backend)}>
              编辑
            </button>
            <button
              disabled={busy}
              onClick={() =>
                action(async () => {
                  await rpc("lan/backends/check", { id: backend.id });
                  await refreshBackends();
                })
              }
            >
              检查连接
            </button>
          </div>
          {backend.error && <p role="status">{backend.error}</p>}
          {backend.type === "claude" && <ProviderSettings backend={backend} />}
        </section>
      ))}
      {editing && (
        <form
          className="backend-form"
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            action(() =>
              saveBackend({
                ...editing,
                dataDir: values.get("dataDir"),
                executable: values.get("executable"),
                url: values.get("url"),
                args: JSON.parse(values.get("args") || "[]"),
                enabled: values.has("enabled"),
              }),
            );
          }}
          key={editing.id || "new"}
        >
          <strong>{editing.name}</strong>
          {editing.type === "codex" && (
            <label>
              服务地址
              <input
                name="url"
                required
                defaultValue={editing.url}
                placeholder="wss://host:port"
              />
            </label>
          )}
          <label>
            执行程序
            <input
              name="executable"
              required
              defaultValue={editing.executable}
            />
          </label>
          <label>
            原生配置目录
            <input
              name="dataDir"
              defaultValue={editing.dataDir}
              placeholder="留空沿用原生默认目录"
            />
          </label>
          <label>
            启动参数（JSON 数组）
            <input
              name="args"
              defaultValue={JSON.stringify(editing.args || [])}
            />
          </label>
          <label className="backend-checkbox">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={editing.enabled}
            />
            启用
          </label>
          <div>
            <button type="submit" disabled={busy}>
              保存后端
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
