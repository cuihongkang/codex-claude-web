import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  memo,
} from "react";
import {
  PanelLeft,
  Plus,
  RefreshCw,
  Square,
  Send,
  LogOut,
  ArrowDown,
} from "lucide-react";
import {
  useClaude,
  openClaude,
  retryClaude,
  loadClaude,
  claudeRpc,
  claudeError,
  setClaudeDraft,
  sendClaude,
} from "./claude-store";
import { set, get } from "./store";
import { IconButton } from "./ui/primitives.jsx";
import { RichText } from "./features/markdown/rich-text.jsx";

import { ClaudeHistory, Permission, newClaude } from "./claude-components.jsx";
export { ClaudeSidebar, newClaude } from "./claude-components.jsx";
export function ClaudeWorkspace() {
  const s = useClaude(),
    [cwd, setCwd] = useState(""),
    [model, setModel] = useState(""),
    [customModel, setCustomModel] = useState(false),
    [effort, setEffort] = useState(""),
    [permissionMode, setPermissionMode] = useState("auto"),
    [configuring, setConfiguring] = useState(false),
    [awayFromBottom, setAwayFromBottom] = useState(false);
  useEffect(() => {
    setModel(s.session?.model || "");
    setCustomModel(
      !["", "opus", "sonnet", "haiku"].includes(s.session?.model || ""),
    );
    setEffort(s.session?.effort || "");
  }, [s.selected, s.session?.model, s.session?.effort]);
  useEffect(() => {
    setPermissionMode(s.session?.permissionMode ?? "auto");
  }, [s.selected, s.session?.permissionMode]);
  const content = useRef(null);
  const pane = useRef(null),
    follow = useRef(true),
    lastScrollTop = useRef(0);
  const draft = s.drafts[s.selected || "new"] || "",
    session = s.session;
  useLayoutEffect(() => {
    follow.current = true;
    setAwayFromBottom(false);
  }, [s.selected]);
  useLayoutEffect(() => {
    const el = pane.current;
    if (el && follow.current) {
      el.scrollTop = el.scrollHeight;
      lastScrollTop.current = el.scrollTop;
    }
  }, [s.messages, s.permissions, s.loading]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const el = pane.current;
      if (follow.current) {
        el.scrollTop = el.scrollHeight;
        lastScrollTop.current = el.scrollTop;
      }
      setAwayFromBottom(el.scrollHeight - el.scrollTop - el.clientHeight >= 80);
    });
    observer.observe(pane.current);
    observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  const running = ["running", "starting"].includes(session?.status),
    blocked = session?.status === "external";
  const act = (method) =>
    claudeRpc(method, { id: s.selected })
      .then(() => openClaude(s.selected))
      .catch(claudeError);
  return (
    <>
      <header className="topbar">
        <IconButton
          icon={PanelLeft}
          title="显示侧栏"
          onClick={() => {
            document.body.classList.remove("sidebar-collapsed");
            set({ sidebar: !get().sidebar });
          }}
        />
        <div className="breadcrumb">
          <strong className="provider-badge">Claude</strong>
          <span>{session?.title || "新 Claude 对话"}</span>
        </div>
        <div className="topbar-actions">
          <IconButton
            icon={RefreshCw}
            title="刷新 Claude 历史"
            onClick={() => openClaude(s.selected, true)}
          />
          {session?.connected && !running && (
            <IconButton
              icon={LogOut}
              title="释放会话，交给 CLI 或 VS Code"
              onClick={() => act("release")}
            />
          )}
          <IconButton
            icon={Plus}
            title="新建 Claude 对话"
            onClick={newClaude}
          />
        </div>
      </header>
      {!s.connected && (
        <div className="connection-banner">
          正在重新连接；电脑上的任务会继续运行。
        </div>
      )}
      <div className="claude-workspace">
        <div
          className="claude-directory"
          title={session?.cwd || cwd || s.defaultCwd}
        >
          {session?.cwd || cwd || s.defaultCwd}
        </div>
        <div className="claude-history-pane">
          <div
            className="claude-messages"
            ref={pane}
            onScroll={() => {
              const el = pane.current;
              const atBottom =
                el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              if (atBottom) follow.current = true;
              else if (el.scrollTop < lastScrollTop.current - 1)
                follow.current = false;
              lastScrollTop.current = el.scrollTop;
              setAwayFromBottom(!atBottom);
            }}
          >
            <div ref={content}>
              {!s.selected && (
                <div className="claude-welcome">
                  <h2>用 Claude 开始工作</h2>
                  <p>任务在这台电脑上运行，手机和电脑可继续同一段对话。</p>
                  <label>
                    工作目录
                    <input
                      aria-label="Claude 工作目录"
                      value={cwd || s.defaultCwd}
                      onChange={(e) => setCwd(e.target.value)}
                    />
                  </label>
                </div>
              )}
              <ClaudeHistory messages={s.messages} cwd={session?.cwd} />
              {s.loading && <p className="claude-status">正在载入历史…</p>}
              {running && (
                <p className="claude-status" role="status">
                  <span className="pulse-dot" />
                  Claude 正在工作…
                </p>
              )}
              {s.permissions.map((request) => (
                <Permission
                  key={request.id}
                  id={s.selected}
                  request={request}
                />
              ))}
            </div>
          </div>
          {awayFromBottom && (
            <button
              className="claude-scroll-bottom"
              title="回到最新消息"
              aria-label="回到最新消息"
              onClick={() => {
                follow.current = true;
                pane.current.scrollTop = pane.current.scrollHeight;
                lastScrollTop.current = pane.current.scrollTop;
                setAwayFromBottom(false);
              }}
            >
              <ArrowDown size={20} />
              <span>回到最新消息</span>
            </button>
          )}
        </div>
        <div className="claude-settings">
          <label>
            模型{" "}
            <select
              aria-label="Claude 模型"
              value={customModel ? "custom" : model}
              onChange={(e) => {
                const custom = e.target.value === "custom";
                setCustomModel(custom);
                setModel(custom ? "" : e.target.value);
              }}
              disabled={configuring || running || blocked}
            >
              <option value="">
                {session?.actualModel
                  ? `默认（${session.actualModel}）`
                  : "默认"}
              </option>
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
              <option value="custom">自定义模型</option>
            </select>
          </label>
          {customModel && (
            <label>
              模型名称{" "}
              <input
                aria-label="Claude 自定义模型"
                value={model}
                placeholder="输入完整模型名"
                onChange={(e) => setModel(e.target.value)}
                disabled={configuring || running || blocked}
              />
            </label>
          )}
          <label>
            思考强度{" "}
            <select
              aria-label="Claude 思考强度"
              value={effort}
              onChange={(e) => setEffort(e.target.value)}
              disabled={configuring || running || blocked}
            >
              <option value="">
                {session?.actualEffort
                  ? `默认（${session.actualEffort}）`
                  : "默认"}
              </option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="xhigh">超高</option>
            </select>
          </label>
          <label>
            权限模式{" "}
            <select
              aria-label="Claude 权限模式"
              value={permissionMode}
              onChange={(e) => setPermissionMode(e.target.value)}
              disabled={configuring || running || blocked}
            >
              {permissionMode === "" && <option value="">保持插件模式</option>}
              <option value="auto">Auto · 自动审核</option>
              <option value="default">Manual · 手动确认</option>
              <option value="acceptEdits">自动编辑</option>
              <option value="plan">Plan · 计划</option>
              <option value="dontAsk">不询问（拒绝需授权操作）</option>
              <option value="bypassPermissions">跳过权限确认</option>
            </select>
          </label>
          {s.selected && (
            <button
              disabled={configuring || running || blocked || !s.connected}
              onClick={async () => {
                setConfiguring(true);
                try {
                  await claudeRpc("configure", {
                    id: s.selected,
                    model: model.trim(),
                    effort,
                    permissionMode,
                  });
                  await retryClaude(s.selected);
                } catch (e) {
                  claudeError(e);
                } finally {
                  setConfiguring(false);
                }
              }}
            >
              {configuring ? "应用中…" : "应用"}
            </button>
          )}
          {session?.shared && <small>与插件共享</small>}
        </div>
        {(s.error || session?.error) && (
          <div className="error-banner" role="alert">
            <span>{s.error || session.error}</span>
            <button
              onClick={() => {
                claudeError("");
                if (s.selected) retryClaude(s.selected);
              }}
            >
              刷新
            </button>
          </div>
        )}
        {blocked ? (
          <div className="claude-blocked">
            此会话正由 {session.owner?.source || "其他客户端"}{" "}
            持有，可查看历史。此进程尚未启用共享；启用后重新打开插件会话一次，再点击重试。
            <button onClick={() => retryClaude(s.selected)}>重试</button>
          </div>
        ) : (
          <div className="claude-composer">
            <textarea
              aria-label="发送给 Claude"
              placeholder={running ? "补充指令…" : "给 Claude 发送消息…"}
              rows={3}
              value={draft}
              onChange={(e) => setClaudeDraft(s.selected, e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  (e.ctrlKey || e.metaKey) &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  if (s.connected && !s.loading)
                    sendClaude({
                      cwd,
                      model: model.trim(),
                      effort,
                      permissionMode,
                    });
                }
              }}
            />
            <div className="claude-composer-actions">
              <small>Ctrl+Enter 发送 · Enter 换行</small>
              {running && (
                <button
                  aria-label="停止 Claude 任务"
                  onClick={() =>
                    claudeRpc("interrupt", { id: s.selected }).catch(
                      claudeError,
                    )
                  }
                >
                  <Square size={14} />
                  停止
                </button>
              )}
              <button
                aria-label="发送给 Claude"
                disabled={
                  !s.connected || s.sending || s.loading || !draft.trim()
                }
                onClick={() =>
                  sendClaude({
                    cwd,
                    model: model.trim(),
                    effort,
                    permissionMode,
                  })
                }
              >
                <Send size={14} />
                {s.sending ? "发送中…" : running ? "补充" : "发送"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
