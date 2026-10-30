import React, { useState, useEffect, useRef } from "react";
import { PanelLeft, Plus, RefreshCw, Square, Send, LogOut } from "lucide-react";
import {
  useClaude,
  openClaude,
  loadClaude,
  claudeRpc,
  claudeError,
  setClaudeDraft,
  sendClaude,
} from "./claude-store";
import { set, get } from "./store";
import { IconButton } from "./workspace";
import { RichText } from "./rich-text";

export function newClaude() {
  set({ provider: "claude", sidebar: false });
  openClaude(null);
}
export function ClaudeSidebar() {
  const s = useClaude();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (s.connected) loadClaude(false, query).catch(claudeError);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, s.connected]);
  return (
    <section className="claude-sidebar" aria-label="Claude 会话">
      <div className="sidebar-section-title">
        <span>Claude</span>
        <div>
          <IconButton
            icon={RefreshCw}
            title="刷新 Claude 会话"
            onClick={() => loadClaude().catch(claudeError)}
          />
          <IconButton
            icon={Plus}
            title="新建 Claude 对话"
            onClick={newClaude}
          />
        </div>
      </div>
      <input
        className="claude-search"
        aria-label="搜索 Claude 会话"
        placeholder="搜索 Claude 会话或目录"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!s.connected && <div className="sidebar-empty">正在连接 Claude…</div>}
      {s.sessions.slice(0, expanded || query ? undefined : 8).map((session) => (
        <div
          key={session.id}
          className={
            "thread-row " +
            (get().provider === "claude" && s.selected === session.id
              ? "selected"
              : "")
          }
        >
          <button
            className="thread-link"
            title={session.title + "\n" + session.cwd}
            onClick={() => {
              set({ provider: "claude", sidebar: false });
              openClaude(session.id);
            }}
          >
            {["running", "starting"].includes(session.status) ? (
              <span className="pulse-dot" />
            ) : (
              <span className="provider-badge">C</span>
            )}
            <span>{session.title}</span>
            <small>
              {session.status === "external"
                ? "其他客户端"
                : session.status === "running"
                  ? "运行中"
                  : "Claude"}
            </small>
          </button>
        </div>
      ))}
      {s.sessions.length > 8 && !query && (
        <button className="load-more" onClick={() => setExpanded(!expanded)}>
          {expanded
            ? "收起 Claude 列表"
            : `显示全部 ${s.sessions.length} 个 Claude 会话`}
        </button>
      )}
      {!s.sessions.length && s.connected && (
        <div className="sidebar-empty">暂无 Claude 会话</div>
      )}
      {s.next !== null && (
        <button
          className="load-more"
          onClick={() => loadClaude(true).catch(claudeError)}
        >
          更多 Claude 会话
        </button>
      )}
    </section>
  );
}
function Content({ message, cwd }) {
  return message.content.filter(Boolean).map((block, index) => {
    if (block.type === "text")
      return <RichText key={index} text={block.text} cwd={cwd} />;
    if (block.type === "thinking")
      return (
        <details key={index} className="claude-tool">
          <summary>思考过程</summary>
          <RichText text={block.thinking} cwd={cwd} />
        </details>
      );
    if (block.type === "tool_use")
      return (
        <details key={index} className="claude-tool">
          <summary>{block.name}</summary>
          <pre>{JSON.stringify(block.input, null, 2)}</pre>
        </details>
      );
    if (block.type === "tool_result")
      return (
        <details key={index} className="claude-tool">
          <summary>{block.is_error ? "工具执行失败" : "工具结果"}</summary>
          <pre>
            {typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content, null, 2)}
          </pre>
        </details>
      );
    if (
      block.type === "image" &&
      block.source?.type === "base64" &&
      /^image\/(png|jpeg|gif|webp)$/.test(block.source.media_type)
    )
      return (
        <img
          key={index}
          alt="会话图片"
          src={`data:${block.source.media_type};base64,${block.source.data}`}
        />
      );
    return null;
  });
}
function Permission({ request, id }) {
  const [answers, setAnswers] = useState({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const questions =
    request.tool === "AskUserQuestion" ? request.input?.questions : [];
  async function answer(allow) {
    setBusy(true);
    setError("");
    try {
      await claudeRpc("answer", { id, requestId: request.id, allow, answers });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="claude-permission">
      <strong>
        {questions?.length
          ? "Claude 需要你的回答"
          : "允许 Claude 执行 " + request.tool + "？"}
      </strong>
      {questions?.length ? (
        questions.map((q, i) => (
          <label key={i}>
            {q.question}
            <input
              value={answers[q.question] || ""}
              list={`answers-${request.id}-${i}`}
              onChange={(e) =>
                setAnswers({ ...answers, [q.question]: e.target.value })
              }
            />
            <datalist id={`answers-${request.id}-${i}`}>
              {q.options?.map((o) => (
                <option key={o.label} value={o.label}>
                  {o.description}
                </option>
              ))}
            </datalist>
          </label>
        ))
      ) : (
        <pre>{JSON.stringify(request.input, null, 2)}</pre>
      )}
      <div>
        <button disabled={busy} onClick={() => answer(false)}>
          拒绝
        </button>
        <button
          disabled={
            busy ||
            (questions?.length &&
              questions.some((q) => !answers[q.question]?.trim()))
          }
          onClick={() => answer(true)}
        >
          {questions?.length ? "提交回答" : "允许本次"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function ClaudeWorkspace() {
  const s = useClaude(),
    [cwd, setCwd] = useState(""),
    [model, setModel] = useState("");
  const pane = useRef(null),
    follow = useRef(true);
  const draft = s.drafts[s.selected || "new"] || "",
    session = s.session;
  useEffect(() => {
    follow.current = true;
  }, [s.selected]);
  useEffect(() => {
    const el = pane.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [s.messages, s.permissions, s.loading]);
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
            onClick={() => openClaude(s.selected)}
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
        <div
          className="claude-messages"
          ref={pane}
          onScroll={() => {
            const el = pane.current;
            follow.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
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
              <label>
                模型
                <input
                  aria-label="Claude 模型"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="沿用本机 Claude 配置"
                  list="claude-models"
                />
                <datalist id="claude-models">
                  <option value="opus" />
                  <option value="sonnet" />
                  <option value="haiku" />
                </datalist>
              </label>
            </div>
          )}
          {s.messages.map((m) => (
            <article
              key={m.id}
              className={
                "claude-message " +
                (m.role === "user" && m.content.some((c) => c.type === "text")
                  ? "claude-user"
                  : "claude-assistant")
              }
            >
              <Content message={m} cwd={session?.cwd} />
            </article>
          ))}
          {s.loading && <p className="claude-status">正在载入历史…</p>}
          {running && (
            <p className="claude-status" role="status">
              <span className="pulse-dot" />
              Claude 正在工作…
            </p>
          )}
          {s.permissions.map((request) => (
            <Permission key={request.id} id={s.selected} request={request} />
          ))}
        </div>
        {(s.error || session?.error) && (
          <div className="error-banner" role="alert">
            <span>{s.error || session.error}</span>
            <button
              onClick={() => {
                claudeError("");
                if (s.selected) openClaude(s.selected);
              }}
            >
              刷新
            </button>
          </div>
        )}
        {blocked ? (
          <div className="claude-blocked">
            此会话正由 {session.owner?.source || "其他客户端"}{" "}
            持有，可查看历史。结束任务并关闭原会话后，点击重试。
            <button onClick={() => openClaude(s.selected)}>重试</button>
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
                  if (s.connected && !s.loading) sendClaude({ cwd, model });
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
                onClick={() => sendClaude({ cwd, model })}
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
