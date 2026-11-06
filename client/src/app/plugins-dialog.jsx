import React, { useEffect, useState } from "react";
import { Blocks, RefreshCw, TerminalSquare } from "lucide-react";
import { useStore, rpc } from "../store.js";
import { currentBackendId } from "../domain/backends.js";

const statusLabels = {
  connected: "已连接",
  pending: "正在连接",
  failed: "连接失败",
  disabled: "已停用",
  "needs-auth": "需要认证",
};

export function PluginsDialog() {
  const s = useStore();
  const backendId = currentBackendId(s);
  const [resource, update] = useState({ data: null, error: "", loading: true });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let cancelled = false,
      timer;
    const params = {
      backendId,
      cwd: s.cwd,
      providerId: s.providerId,
      threadId: s.current?.id,
    };
    update({ data: null, error: "", loading: true });
    async function read() {
      try {
        const [plugins, mcp] = await Promise.all([
          rpc("plugin/installed", params),
          (async () => {
            const data = [];
            let cursor;
            do {
              const page = await rpc("mcpServerStatus/list", {
                ...params,
                limit: 100,
                ...(cursor && { cursor }),
              });
              if (cancelled) return null;
              data.push(...page.data);
              cursor = page.nextCursor;
            } while (cursor);
            return data;
          })(),
        ]);
        if (cancelled) return;
        update({
          data: {
            plugins:
              plugins.marketplaces?.flatMap(
                (marketplace) => marketplace.plugins || [],
              ) || [],
            mcp,
          },
          error: "",
          loading: false,
        });
        if (mcp.some((server) => server.status === "pending"))
          timer = setTimeout(read, 3000);
      } catch (error) {
        if (!cancelled)
          update((previous) => ({
            ...previous,
            error: error.message,
            loading: false,
          }));
      }
    }
    read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [backendId, s.cwd, s.providerId, s.current?.id, attempt]);
  return (
    <div className="catalog-list">
      <button
        type="button"
        className="secondary"
        disabled={resource.loading}
        onClick={() => retry((value) => value + 1)}
      >
        <RefreshCw size={14} />
        刷新
      </button>
      {resource.error && (
        <div className="inline-error" role="alert">
          {resource.error}
        </div>
      )}
      {resource.loading && <div className="loading">正在读取插件与连接…</div>}
      {resource.data && (
        <>
          {resource.data.plugins.map((plugin) => (
            <div className="catalog-card" key={plugin.id || plugin.name}>
              <div className="catalog-icon">
                <Blocks size={20} />
              </div>
              <div>
                <strong>{plugin.interface?.displayName || plugin.name}</strong>
                {plugin.interface?.shortDescription && (
                  <p>{plugin.interface.shortDescription}</p>
                )}
                {plugin.errors?.length > 0 && (
                  <p role="alert">
                    {plugin.errors
                      .map((error) =>
                        typeof error === "string" ? error : error.message,
                      )
                      .join("；")}
                  </p>
                )}
              </div>
              <span className="status-tag">
                {plugin.enabled ? "已启用" : "已停用"}
              </span>
            </div>
          ))}
          {!resource.data.plugins.length && <p>当前工作目录没有已安装插件。</p>}
          <h3 className="section-label">工具连接</h3>
          {resource.data.mcp.map((server) => (
            <div className="catalog-card" key={server.name}>
              <div className="catalog-icon">
                <TerminalSquare size={20} />
              </div>
              <div>
                <strong>{server.name}</strong>
                <p>
                  {Object.keys(server.tools || {}).length} 项工具
                  {statusLabels[server.status] &&
                    ` · ${statusLabels[server.status]}`}
                </p>
                {server.error && (
                  <p role="alert">
                    {typeof server.error === "string"
                      ? server.error
                      : server.error.message}
                  </p>
                )}
              </div>
            </div>
          ))}
          {!resource.data.mcp.length && <p>当前工作目录没有工具连接。</p>}
        </>
      )}
    </div>
  );
}
