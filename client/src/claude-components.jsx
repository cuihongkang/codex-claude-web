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
// Draft changes must not reparse Markdown or serialize every historical tool.
export const ClaudeHistory = memo(function ClaudeHistory({ messages, cwd }) {
  return (
    <>
      {messages.map((m) => (
        <article
          key={m.id}
          className={
            "claude-message " +
            (m.role === "user" &&
            (!m.kind || m.kind === "user") &&
            m.content.some((c) => c.type === "text")
              ? "claude-user"
              : "claude-assistant")
          }
        >
          {["context", "system"].includes(m.kind) ? (
            <SystemMessage message={m} cwd={cwd} />
          ) : (
            <Content message={m} cwd={cwd} />
          )}
        </article>
      ))}
    </>
  );
});

function SystemMessage({ message, cwd }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="claude-tool claude-system-message"
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary>
        {message.kind === "context" ? "上下文整理摘要" : "系统消息"}
      </summary>
      {expanded && <Content message={message} cwd={cwd} />}
    </details>
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
export function Permission({ request, id }) {
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
