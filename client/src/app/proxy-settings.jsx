import React, { useEffect, useState } from "react";
import { saveBackend } from "../store.js";

export function ProxySettings({ backend, disabled }) {
  const [mode, setMode] = useState("system");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const custom = ["http", "https"].includes(mode);
  useEffect(() => {
    setMode(backend.proxy?.mode || "system");
    setHost(backend.proxy?.host || "127.0.0.1");
    setPort(String(backend.proxy?.port || ""));
  }, [backend.proxy?.mode, backend.proxy?.host, backend.proxy?.port]);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    setError("");
    try {
      await saveBackend({
        id: backend.id,
        type: backend.type,
        proxy: { mode, ...(custom && { host, port: Number(port) }) },
      });
      setStatus("代理配置已保存");
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="backend-form proxy-settings"
      onSubmit={submit}
      aria-label="Claude Code 网络代理"
    >
      <div className="proxy-row">
        <label className="proxy-protocol">
          网络代理
          <select
            aria-label="网络代理"
            value={mode}
            disabled={busy || disabled}
            onChange={(event) => {
              setMode(event.target.value);
              setStatus("");
            }}
          >
            <option value="system">跟随服务环境</option>
            <option value="off">关闭代理</option>
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
          </select>
        </label>
        {custom && (
          <>
            <input
              className="proxy-address"
              aria-label="代理地址"
              placeholder="地址"
              required
              value={host}
              disabled={busy || disabled}
              onChange={(event) => setHost(event.target.value)}
              autoComplete="off"
            />
            <input
              className="proxy-port"
              aria-label="代理端口"
              placeholder="端口"
              type="number"
              required
              min="1"
              max="65535"
              step="1"
              value={port}
              disabled={busy || disabled}
              onChange={(event) => setPort(event.target.value)}
            />
          </>
        )}
        <button type="submit" disabled={busy || disabled}>
          {busy ? "正在保存…" : "保存代理"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
    </form>
  );
}
