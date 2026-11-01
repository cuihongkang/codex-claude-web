import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  CheckCircle2,
  ChevronRight,
  Files,
  GitPullRequest,
  LoaderCircle,
  RefreshCw,
  TerminalSquare,
  Users,
  X,
} from "lucide-react";
import { onEvent, openSubAgent, rpc, set, useStore } from "./store";
import {
  agentStatusLabels,
  applyAgentEvent,
  mergeAgentHistory,
  subAgents,
  withParentMessages,
} from "./sub-agents";
import { ReadOnlyConversation } from "./chat";
import { ChangesPanel, FilePanel, IconButton } from "./workspace";
import { reasoningEffortLabels } from "./reasoning-effort";
import { readThreadHistory } from "./thread-history";

export function ContextCard() {
  const s = useStore();
  const agents = subAgents(s.items);
  return (
    <section className="context-card" aria-label="对话功能">
      <div className="context-card-heading">
        <strong>工作区</strong>
      </div>
      <nav aria-label="工作区工具">
        <button onClick={() => set({ panel: "files", contextOpen: true })}>
          <Files size={17} />
          <span>文件</span>
          <ChevronRight size={14} />
        </button>
        <button onClick={() => set({ panel: "changes", contextOpen: true })}>
          <GitPullRequest size={17} />
          <span>变更</span>
          <ChevronRight size={14} />
        </button>
        <button
          aria-pressed={s.terminalOpen}
          onClick={() => set({ terminalOpen: !s.terminalOpen })}
        >
          <TerminalSquare size={17} />
          <span>终端</span>
          <small>{s.terminalOpen ? "已打开" : "打开"}</small>
        </button>
      </nav>
      {agents.length > 0 && (
        <div className="context-agents">
          <div className="context-section-heading">
            <strong>子代理</strong>
            <small>{agents.length}</small>
          </div>
          <div className="context-agent-list">
            {agents.map((agent) => (
              <button
                key={agent.id}
                title={agent.path || agent.id}
                onClick={() => openSubAgent(agent)}
              >
                <Users size={17} />
                <span>
                  <b>{agent.name}</b>
                  <small data-status={agent.status}>
                    {agentStatusLabels[agent.status] || agent.status}
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SubAgentConversation({ agent }) {
  const { connected } = useStore();
  const [attempt, retry] = useState(0);
  const [history, update] = useState({ items: [], turns: [], loading: true });
  const [parentMessages, setParentMessages] = useState([]);
  const [messageError, setMessageError] = useState("");
  const scroll = useRef();
  const heading = useRef();
  const follow = useRef(true);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [agent.id]);
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    let hydrated = false;
    const events = [];
    const liveTurns = new Map();
    let messageRequest = 0;
    async function loadMessages() {
      const request = ++messageRequest;
      try {
        const result = await rpc("lan/agents/messages", { threadId: agent.id });
        if (cancelled || request !== messageRequest) return;
        setParentMessages(result.messages || []);
        setMessageError("");
      } catch (error) {
        if (!cancelled && request === messageRequest)
          setMessageError(error.message);
      }
    }
    loadMessages();
    update((previous) => ({ ...previous, loading: true, error: "" }));
    const unsubscribe = onEvent(({ method, params: p }) => {
      if (
        p?.threadId === agent.parentId &&
        p.item &&
        ["item/started", "item/completed"].includes(method) &&
        subAgents([p.item]).some((entry) => entry.id === agent.id)
      )
        loadMessages();
      if (p?.threadId !== agent.id) return;
      if (["turn/started", "turn/completed"].includes(method)) {
        loadMessages();
        liveTurns.set(p.turn.id, { ...liveTurns.get(p.turn.id), ...p.turn });
        update((previous) => ({
          ...previous,
          turns: [
            {
              ...previous.turns.find((turn) => turn.id === p.turn.id),
              ...p.turn,
            },
            ...previous.turns.filter((turn) => turn.id !== p.turn.id),
          ],
        }));
      }
      if (
        [
          "item/started",
          "item/completed",
          "item/agentMessage/delta",
          "item/commandExecution/outputDelta",
          "item/reasoning/summaryTextDelta",
        ].includes(method)
      ) {
        if (!hydrated) events.push({ method, params: p });
        update((previous) => ({
          ...previous,
          items: applyAgentEvent(previous.items, method, p),
        }));
      }
    });
    async function pages(method, params) {
      const data = [];
      let cursor;
      do {
        const page = await rpc(method, {
          threadId: agent.id,
          ...params,
          ...(cursor ? { cursor } : {}),
        });
        if (cancelled) return [];
        data.push(...page.data);
        cursor = page.nextCursor;
      } while (cursor);
      return data;
    }
    async function load() {
      try {
        const [{ thread }, turns, records] = await Promise.all([
          rpc("thread/read", { threadId: agent.id, includeTurns: false }),
          pages("thread/turns/list", {
            limit: 20,
            itemsView: "notLoaded",
            sortDirection: "desc",
          }),
          readThreadHistory(rpc, agent.id, {
            current: () => !cancelled,
            sortDirection: "asc",
          }),
        ]);
        if (cancelled) return;
        const items = mergeAgentHistory(records, events);
        events.length = 0;
        hydrated = true;
        update({
          thread,
          items,
          turns: [
            ...[...liveTurns.values()].reverse().map((turn) => ({
              ...turns.find((entry) => entry.id === turn.id),
              ...turn,
            })),
            ...turns.filter((turn) => !liveTurns.has(turn.id)),
          ],
          loading: false,
        });
      } catch (error) {
        events.length = 0;
        hydrated = true;
        if (!cancelled)
          update((previous) => ({
            ...previous,
            loading: false,
            error: error.message,
          }));
      }
    }
    load();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [agent.id, agent.parentId, connected, attempt]);
  const items = withParentMessages(history.items, parentMessages);
  useEffect(() => {
    const element = scroll.current;
    if (element && follow.current) element.scrollTop = element.scrollHeight;
  }, [history.items, parentMessages]);
  const turn = history.turns[0];
  const status = turn?.status || agent.status;
  const model = history.thread?.model || agent.model;
  const effort = history.thread?.reasoningEffort || agent.reasoningEffort;
  return (
    <section
      className="subagent-conversation"
      aria-label={agent.name + "的对话"}
      ref={heading}
      tabIndex={-1}
    >
      <div className="panel-heading">
        <span>
          <Users size={16} />
          <strong>{agent.name}</strong>
        </span>
        <IconButton
          icon={RefreshCw}
          title="刷新子代理对话"
          onClick={() => retry((value) => value + 1)}
        />
      </div>
      <div className="subagent-meta">
        <span data-status={status}>
          {status === "completed" ? <CheckCircle2 size={13} /> : null}
          {agentStatusLabels[status] || status}
        </span>
        <span>子代理对话 · 只读</span>
        {model && <span>{model}</span>}
        {effort && (
          <span>思考强度 {reasoningEffortLabels[effort] || effort}</span>
        )}
        {agent.path && <code>{agent.path}</code>}
      </div>
      <div
        className="subagent-history"
        ref={scroll}
        onScroll={() => {
          const element = scroll.current;
          follow.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            100;
        }}
      >
        {!connected && (
          <p className="subagent-notice" role="status">
            连接恢复后自动更新子代理对话。
          </p>
        )}
        {connected && history.loading && (
          <p className="subagent-notice" role="status">
            <LoaderCircle size={14} className="spin" />
            正在读取子代理对话…
          </p>
        )}
        {history.error && (
          <div className="subagent-notice" role="alert">
            <p>{history.error}</p>
            <button
              className="secondary"
              onClick={() => retry((value) => value + 1)}
            >
              重试读取
            </button>
          </div>
        )}
        {messageError && (
          <div className="subagent-notice" role="alert">
            <p>读取主代理消息失败：{messageError}</p>
            <button
              className="secondary"
              onClick={() => retry((value) => value + 1)}
            >
              重试读取
            </button>
          </div>
        )}
        {!history.loading && !history.error && !items.length && (
          <p className="subagent-notice">该子代理暂无可读取的对话记录。</p>
        )}
        <ReadOnlyConversation
          items={items}
          cwd={history.thread?.cwd}
          turns={history.turns}
        />
      </div>
    </section>
  );
}

export function ContextWorkspace() {
  const s = useStore();
  const [filesOpened, keepFiles] = useState(s.panel === "files");
  const detailsOpen = s.contextOpen === true;
  const agent = s.panelAgent?.parentId === s.current?.id ? s.panelAgent : null;
  useEffect(() => {
    if (s.panel === "files") keepFiles(true);
    if (s.panel === "agent" && !agent) set({ panel: null, panelAgent: null });
  }, [s.panel, agent]);
  return (
    <>
      <aside
        id="conversation-context"
        className={"context-workspace " + (s.panel ? "showing-panel" : "")}
        data-open={detailsOpen}
        aria-label="对话详情"
      >
        {s.panel ? (
          <div className="context-backbar">
            <button onClick={() => set({ panel: null })}>
              <ArrowLeft size={15} />
              返回概览
            </button>
            <IconButton
              icon={X}
              title="收起对话详情"
              onClick={() => set({ contextOpen: false })}
            />
          </div>
        ) : (
          <ContextCard />
        )}
        {filesOpened && (
          <div
            className="context-panel file-workspace"
            style={{ display: s.panel === "files" ? "flex" : "none" }}
          >
            <FilePanel />
          </div>
        )}
        {s.panel === "changes" && (
          <div className="context-panel">
            <ChangesPanel />
          </div>
        )}
        {s.panel === "agent" && agent && detailsOpen && (
          <SubAgentConversation
            key={s.current.id + ":" + agent.id}
            agent={agent}
          />
        )}
      </aside>
      <nav
        className="context-tools"
        data-open={detailsOpen}
        aria-label="工作区快捷工具"
      >
        <IconButton
          icon={Files}
          title="文件"
          active={s.panel === "files"}
          aria-pressed={s.panel === "files"}
          onClick={() =>
            set(
              s.panel === "files" ? { contextOpen: false } : { panel: "files" },
            )
          }
        />
        <IconButton
          icon={GitPullRequest}
          title="变更"
          active={s.panel === "changes"}
          aria-pressed={s.panel === "changes"}
          onClick={() =>
            set(
              s.panel === "changes"
                ? { contextOpen: false }
                : { panel: "changes" },
            )
          }
        />
        <IconButton
          icon={TerminalSquare}
          title="终端"
          active={s.terminalOpen}
          aria-pressed={s.terminalOpen}
          onClick={() => set({ terminalOpen: !s.terminalOpen })}
        />
        <IconButton
          icon={detailsOpen ? ChevronRight : ChevronLeft}
          title={detailsOpen ? "折叠对话详情" : "展开对话详情"}
          aria-expanded={detailsOpen}
          aria-controls="conversation-context"
          onClick={() => set({ contextOpen: !detailsOpen })}
        />
      </nav>
    </>
  );
}
