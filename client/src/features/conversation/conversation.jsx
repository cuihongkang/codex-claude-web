import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import codexWebIcon from "../../assets/codex-web.svg";
import {
  ArrowDown,
  GitBranch,
  ChevronRight,
  FileCode,
  LoaderCircle,
  ListChecks,
  CheckCircle2,
} from "lucide-react";
import { useStore, setDraft } from "../../store.js";
import { actionableMessages } from "../../domain/message-actions.js";
import { conversationGroups } from "../../domain/conversation-groups.js";
import { annotationContexts } from "../../domain/annotations.js";
import { TurnFileChanges } from "./turn-file-changes.jsx";
import { ConversationNavigation } from "./conversation-navigation.jsx";
import { isCompacting } from "../../domain/compaction.js";
import { Message, ReplyActions } from "./message.jsx";

import { Question } from "./questions.jsx";
import { ProcessGroup } from "./process-group.jsx";
export function ReadOnlyConversation({ items, cwd, turns }) {
  const annotations = annotationContexts(items);
  const groups = conversationGroups(items, [], turns);
  return groups.map((group) =>
    group.type === "process" ? (
      <ProcessGroup
        key={group.id}
        group={group}
        working={turns.some(
          (turn) => turn.id === group.turnId && turn.status === "inProgress",
        )}
        timing={turns.find((turn) => turn.id === group.turnId)}
        annotations={annotations}
        readOnly
        cwd={cwd}
      />
    ) : group.type === "message" ? (
      <Message
        key={group.id}
        item={group.item}
        annotations={annotations.get(group.item.id)}
        readOnly
        cwd={cwd}
      />
    ) : null,
  );
}
export function Conversation({ children }) {
  const s = useStore(),
    scroll = useRef(),
    column = useRef(),
    follow = useRef(true);
  const [below, setBelow] = useState(false);
  const annotations = annotationContexts(s.items);
  const active = s.active[s.current?.id],
    plan = s.plans[s.current?.id];
  const compacting = isCompacting(s.compactions[s.current?.id]);
  const actions = actionableMessages(
    s.items,
    s.turns[s.current?.id] || [],
    active,
  );
  const groups = conversationGroups(
    s.items,
    s.questions.filter(
      (question) => question.params?.threadId === s.current?.id,
    ),
    [
      ...(s.turns[s.current?.id] || []),
      ...Object.entries(s.turnTimings[s.current?.id] || {}).map(
        ([id, timing]) => ({ id, ...timing }),
      ),
    ],
  );
  const replies = new Map(
    s.items
      .filter((item) => actions.has(item.id))
      .map((item) => [item.turnId, item]),
  );
  const lastGroups = new Map();
  for (const group of groups) {
    const turnId = group.turnId || group.item?.turnId;
    if (turnId) lastGroups.set(turnId, group.id);
  }
  useLayoutEffect(() => {
    follow.current = true;
    setBelow(false);
  }, [s.current?.id]);
  useLayoutEffect(() => {
    const element = scroll.current;
    if (element && follow.current) element.scrollTop = element.scrollHeight;
  }, [
    s.current?.id,
    s.items,
    s.questions,
    plan,
    active,
    s.turnDiffs,
    s.loading,
  ]);
  useEffect(() => {
    const element = scroll.current;
    const content = column.current;
    if (!element || !content) return;
    const observer = new ResizeObserver(() => {
      if (follow.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    observer.observe(content, { box: "border-box" });
    return () => observer.disconnect();
  }, [s.current?.id, s.loading]);
  if (!s.current && !s.loading)
    return (
      <div className="conversation-layout">
        <div className="welcome">
          <div className="welcome-symbol">
            <img src={codexWebIcon} width={56} height={56} alt="" />
          </div>
          <h1>今天想完成什么？</h1>
          <p>从一个想法开始，把工作交给 Codex。</p>
          <div className="suggestions">
            {[
              {
                icon: FileCode,
                title: "了解这个项目",
                text: "请阅读当前项目，介绍它的结构、运行方式和主要模块。",
              },
              {
                icon: GitBranch,
                title: "检查代码变更",
                text: "请审查当前项目尚未提交的代码变更，指出确实存在的问题。",
              },
              {
                icon: ListChecks,
                title: "制定实现计划",
                text: "我想实现一个新功能。先了解项目，并和我一起制定实现计划。",
              },
            ].map(({ icon: Icon, title, text }) => (
              <button
                key={title}
                onClick={() => {
                  setDraft(text);
                  document.querySelector('[aria-label="消息"]')?.focus();
                }}
              >
                <Icon size={19} />
                <span>{title}</span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        </div>
        {children}
      </div>
    );
  return (
    <div className="conversation-layout">
      <div className="conversation-wrap">
        <div
          className="conversation"
          ref={scroll}
          onScroll={() => {
            const e = scroll.current;
            follow.current =
              e.scrollHeight - e.scrollTop - e.clientHeight < 100;
            setBelow(!follow.current);
          }}
        >
          <div className="message-column" ref={column}>
            {s.loading ? (
              <div className="loading">
                <LoaderCircle className="spin" size={16} />
                正在打开对话…
              </div>
            ) : (
              groups.map((group) => {
                const turnId = group.turnId || group.item?.turnId;
                return (
                  <React.Fragment key={`${s.current?.id}:${group.id}`}>
                    {group.type === "process" ? (
                      <ProcessGroup
                        key={`${s.current?.id}:${group.id}`}
                        group={group}
                        annotations={annotations}
                        working={!!active && active === group.turnId}
                        timing={s.turnTimings[s.current?.id]?.[group.turnId]}
                      />
                    ) : group.type === "request" ? (
                      <Question request={group.request} />
                    ) : (
                      <Message
                        key={`${s.current?.id}:${group.id}`}
                        item={group.item}
                        annotations={annotations.get(group.item.id)}
                      />
                    )}
                    {turnId && lastGroups.get(turnId) === group.id && (
                      <>
                        <TurnFileChanges
                          turnId={turnId}
                          items={s.items.filter(
                            (item) => item.turnId === turnId,
                          )}
                        />
                        {replies.has(turnId) && (
                          <ReplyActions item={replies.get(turnId)} />
                        )}
                      </>
                    )}
                  </React.Fragment>
                );
              })
            )}
            {plan?.plan?.length > 0 && (
              <details className="plan-card" open={!!active}>
                <summary>
                  <ListChecks size={16} />
                  计划 ·{" "}
                  {plan.plan.filter((p) => p.status === "completed").length}/
                  {plan.plan.length}
                </summary>
                {plan.plan.map((p, i) => (
                  <div key={i}>
                    {p.status === "completed" ? (
                      <CheckCircle2 size={15} />
                    ) : p.status === "inProgress" ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <span className="step-dot" />
                    )}
                    <span className={p.status === "completed" ? "done" : ""}>
                      {p.step}
                    </span>
                  </div>
                ))}
              </details>
            )}
            {active && (
              <div className="working-status">
                <span className="pulse-dot" />
                {compacting ? "正在整理上下文" : "Codex 正在工作"}
              </div>
            )}
          </div>
        </div>
        {below && (
          <button
            className="scroll-bottom"
            title="回到最新消息"
            onClick={() => {
              follow.current = true;
              scroll.current?.scrollTo({
                top: scroll.current.scrollHeight,
                behavior: "smooth",
              });
            }}
          >
            <ArrowDown size={16} />
          </button>
        )}
      </div>
      {children}
      {!s.loading &&
        groups.some((group) => group.item?.type === "userMessage") && (
          <ConversationNavigation
            key={s.current?.id}
            groups={groups}
            scroll={scroll}
            onNavigate={() => {
              follow.current = false;
              setBelow(true);
            }}
          />
        )}
    </div>
  );
}
