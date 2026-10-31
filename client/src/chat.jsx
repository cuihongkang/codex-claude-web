import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import codexWebIcon from "./assets/codex-web.svg";
import {
  ArrowUp,
  ArrowDown,
  Square,
  Plus,
  X,
  Copy,
  GitBranch,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Check,
  TerminalSquare,
  FileCode,
  Globe,
  Brain,
  LoaderCircle,
  Paperclip,
  Folder,
  Sparkles,
  ListChecks,
  Shield,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Users,
  ImageIcon,
} from "lucide-react";
import {
  useStore,
  useDraft,
  get,
  set,
  selectModel,
  setDraft,
  sendMessage,
  refreshThreadAccess,
  compact,
  refreshCompaction,
  rpc,
  stop,
  report,
  copy,
  fork,
  attachFile,
  respond,
  basename,
  addAttachment,
  uid,
  openSubAgent,
  editUserMessage,
} from "./store";
import { IconButton, DiffBlock } from "./workspace";
import { useComposerShortcuts } from "./shortcuts";
import { submitComposer } from "./composer-commands";
import { actionableMessages } from "./message-actions";
import { reasoningSummaries } from "./reasoning-summary";
import { useSummaryTranslation } from "./use-summary-translation";
import { conversationGroups } from "./conversation-groups";
import {
  ActivityContent,
  activityLabel,
  activityHasImage,
} from "./activity-content";
import { QuestionRecord, UserInputForm } from "./user-input";
import { ServiceTierToggle } from "./service-tier-toggle";
import { ReasoningEffortControl } from "./reasoning-effort";
import { MessageImage } from "./message-image";
import { RichText } from "./rich-text";
import { annotationContexts } from "./annotations";
import {
  UserAnnotations,
  MessageAnnotations,
  ComposerAnnotations,
} from "./message-annotations";
import { useAnnotationDrafts } from "./annotation-drafts";
import { TurnFileChanges } from "./turn-file-changes";
import { turnElapsedMs, formatElapsed } from "./turn-timing";
import { ConversationNavigation } from "./conversation-navigation";
import { isCompacting } from "./compaction";
import { isSubAgentItem, subAgentAction, subAgents } from "./sub-agents";
import { parseUserMessage, userMessageText } from "./user-message.js";
export { RichText } from "./rich-text";
function Content({ content, cwd }) {
  const parsed = parseUserMessage(content);
  const used = new Set();
  const parts = [];
  let offset = 0;
  const references = [...parsed.references].sort(
    (a, b) => b.name.length - a.name.length,
  );
  for (let index = 0; (index = parsed.text.indexOf("@", index)) !== -1;) {
    const file = references.find((file) =>
      parsed.text.startsWith("@" + file.name, index),
    );
    if (!file) {
      index++;
      continue;
    }
    parts.push(parsed.text.slice(offset, index));
    parts.push(<FileReference key={index} file={file} />);
    used.add(file.path);
    offset = index + file.name.length + 1;
    index = offset;
  }
  parts.push(parsed.text.slice(offset));
  return (
    <>
      {parsed.text && <div className="user-text">{parts}</div>}
      {parsed.references.some((file) => !used.has(file.path)) && (
        <div className="user-reference-list">
          {parsed.references
            .filter((file) => !used.has(file.path))
            .map((file, index) => (
              <FileReference key={index} file={file} />
            ))}
        </div>
      )}
      <UserAnnotations annotations={parsed.annotations} />
      {parsed.attachments.map((c, i) =>
        c.type === "image" || c.type === "localImage" ? (
          <div key={i} className="message-image">
            {c.url || c.path ? (
              <MessageImage src={c.url || c.path} alt="图片附件" cwd={cwd} />
            ) : (
              <span>
                <Paperclip size={14} />
                {c.path || "图片附件"}
              </span>
            )}
          </div>
        ) : c.type === "skill" ? (
          <span key={i} className="skill-tag">
            <Sparkles size={14} />
            {c.name}
          </span>
        ) : null,
      )}
    </>
  );
}
function FileReference({ file }) {
  const Icon = file.directory ? Folder : FileCode;
  const label = (
    <>
      <Icon size={14} aria-hidden="true" />
      <span>{file.name}</span>
    </>
  );
  return (
    <a
      className="user-file-reference"
      href={file.path}
      title={file.path}
      onClick={(event) => {
        event.preventDefault();
        set({
          panel: "files",
          panelFile: file.directory
            ? { path: file.path, view: "directory" }
            : file.path,
        });
      }}
    >
      {label}
    </a>
  );
}
function Activity({ item, cwd }) {
  const [expanded, setOpen] = useState(null);
  const open = expanded ?? activityHasImage(item);
  const working = ["inProgress", "running"].includes(item.status);
  const failed =
    ["failed", "declined"].includes(item.status) ||
    item.success === false ||
    Boolean(item.error) ||
    item.result?.isError === true;
  if (isSubAgentItem(item)) {
    const agents = subAgents([item]);
    return (
      <div className="activity subagent-activity">
        <button
          className="activity-summary"
          onClick={() => {
            if (agents.length === 1) openSubAgent(agents[0]);
            else set({ panel: null, contextOpen: true });
          }}
        >
          <Users size={15} />
          <span>
            {subAgentAction(item)}
            {agents.length === 1
              ? " · " + agents[0].name
              : agents.length
                ? ` · ${agents.length} 个`
                : ""}
          </span>
          {failed && <AlertCircle size={14} />}
          <ChevronRight size={13} />
        </button>
      </div>
    );
  }
  const Icon =
    item.type === "commandExecution"
      ? TerminalSquare
      : item.type === "fileChange"
        ? FileCode
        : item.type === "webSearch"
          ? Globe
          : activityHasImage(item)
            ? ImageIcon
            : Sparkles;
  const label = activityLabel(item);
  return (
    <div className={"activity " + (open ? "expanded" : "")}>
      <button
        className="activity-summary"
        aria-expanded={open}
        title={item.type === "commandExecution" ? item.command : undefined}
        onClick={() => setOpen(!open)}
      >
        {working ? (
          <LoaderCircle size={15} className="spin" />
        ) : (
          <Icon size={15} />
        )}
        <span>{label}</span>
        {item.type === "fileChange" && (
          <small>{item.changes?.length || 0} 个文件</small>
        )}
        {failed ? (
          <AlertCircle size={14} aria-label="执行失败" />
        ) : item.status === "completed" ? (
          <Check size={13} />
        ) : null}
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="activity-body">
          {item.type === "commandExecution" ? (
            <>
              <small>原始命令</small>
              <pre>{item.command || "—"}</pre>
              <small>输出</small>
              <pre>{item.aggregatedOutput || "暂无输出"}</pre>
              <small>
                退出码 {item.exitCode ?? "—"} · {item.cwd}
              </small>
            </>
          ) : item.type === "fileChange" ? (
            (item.changes || []).map((c) => (
              <div key={c.path}>
                <button
                  className="changed-path"
                  onClick={() =>
                    set({
                      panel: "files",
                      panelFile: c.path.startsWith("/")
                        ? c.path
                        : (cwd || get().cwd) + "/" + c.path,
                      contextOpen: true,
                    })
                  }
                >
                  <FileCode size={14} />
                  {c.path}
                </button>
                <DiffBlock diff={c.diff} />
              </div>
            ))
          ) : item.type === "plan" ? (
            <RichText text={item.text || ""} cwd={cwd} />
          ) : (
            <ActivityContent item={item} cwd={cwd} />
          )}
        </div>
      )}
    </div>
  );
}
function Reasoning({ item, cwd }) {
  return reasoningSummaries(item.summary).map((summary, index) => (
    <ReasoningPart key={index} {...summary} cwd={cwd} />
  ));
}
function ReasoningPart({ title, body, cwd }) {
  const heading = useSummaryTranslation(title, "title");
  const content = useSummaryTranslation(body);
  const status = heading.pending ? (
    <LoaderCircle size={12} className="spin" aria-label="正在翻译标题" />
  ) : null;
  return (
    <>
      {body ? (
        <details className="activity reasoning-summary">
          <summary className="activity-summary" title={title}>
            <Brain size={15} />
            <span>{heading.text}</span>
            {status}
            <ChevronRight className="summary-chevron" size={13} />
          </summary>
          <div className="activity-body">
            {content.pending ? (
              <span className="translation-status">正在翻译摘要…</span>
            ) : (
              <RichText text={content.text} cwd={cwd} />
            )}
            {content.error && (
              <button
                className="translation-retry"
                title={content.error}
                onClick={content.retry}
              >
                翻译失败，点击重试
              </button>
            )}
          </div>
        </details>
      ) : (
        <div className="activity reasoning-summary">
          <div className="activity-summary reasoning-title" title={title}>
            <Brain size={15} />
            <span>{heading.text}</span>
            {status}
          </div>
        </div>
      )}
      {heading.error && (
        <button
          className="translation-retry"
          title={heading.error}
          onClick={heading.retry}
        >
          标题翻译失败，点击重试
        </button>
      )}
    </>
  );
}
function Message({ item, annotations, readOnly = false, cwd }) {
  if (item.type === "reasoning") return <Reasoning item={item} cwd={cwd} />;
  if (item.type === "userInputRequest")
    return (
      <QuestionRecord
        questions={item.request.params.questions}
        answers={item.answers}
      />
    );
  if (readOnly && item.type === "agentMessage")
    return (
      <article
        className={
          "message " +
          (item.phase === "commentary"
            ? "process-message"
            : "assistant-message")
        }
      >
        {item.text?.trim() && (
          <RichText text={item.text} annotations={annotations} cwd={cwd} />
        )}
        {item.questions?.length > 0 && (
          <QuestionRecord
            questions={item.questions.map((question, index) => ({
              id: String(index),
              header: `问题 ${index + 1}`,
              question: question.title,
              options: question.options?.map((label) => ({ label })),
            }))}
            answers={
              item.questionAnswers &&
              Object.fromEntries(
                item.questionAnswers.map((text, index) => [
                  String(index),
                  { answers: [text] },
                ]),
              )
            }
          />
        )}
      </article>
    );
  if (item.type === "agentMessage" && item.questions?.length) {
    const context = item.text?.trim() &&
      !item.questions.some(
        (question) => question.title.trim() === item.text.trim(),
      ) && (
        <MessageAnnotations item={item}>
          <RichText text={item.text} annotations={annotations} />
        </MessageAnnotations>
      );
    if (item.questionAnswers || item.questionClosed)
      return <AsyncQuestion item={item} context={context} />;
    return (
      <article className="message assistant-message">
        {context}
        <AsyncQuestion item={item} context={context} />
      </article>
    );
  }
  if (item.type === "agentMessage" && item.phase === "commentary")
    return item.text?.trim() ? (
      <article className="message process-message">
        <MessageAnnotations item={item}>
          <RichText text={item.text} annotations={annotations} />
        </MessageAnnotations>
      </article>
    ) : null;
  if (item.type === "userMessage")
    return (
      <article
        className="message user-message"
        data-message-id={item.id}
        tabIndex={-1}
      >
        <div className="user-bubble">
          <Content content={item.content} cwd={cwd} />
        </div>
        {!readOnly && (
          <div className="message-actions">
            <IconButton
              icon={Copy}
              title="复制消息"
              onClick={() => copy(userMessageText(item.content))}
            />
            <IconButton
              icon={RotateCcw}
              title="编辑并重新发送"
              onClick={() => {
                editUserMessage(item);
                document.querySelector('[aria-label="消息"]')?.focus();
              }}
            />
          </div>
        )}
      </article>
    );
  if (item.type === "agentMessage")
    return (
      <article className="message assistant-message">
        <MessageAnnotations item={item}>
          <RichText text={item.text} annotations={annotations} />
        </MessageAnnotations>
      </article>
    );
  return <Activity item={item} cwd={cwd} />;
}
function ReplyActions({ item }) {
  return (
    <div className="message-actions reply-actions" aria-label="回复操作">
      <IconButton
        icon={Copy}
        title="复制回复"
        onClick={() => copy(item.text)}
      />
      <IconButton
        icon={GitBranch}
        title="从这里创建分支"
        onClick={() => fork(get().current, item.turnId).catch(report)}
      />
    </div>
  );
}
function AsyncQuestion({ item, context }) {
  const s = useStore();
  const questions = item.questions.map((question, index) => ({
    id: String(index),
    header: `问题 ${index + 1}`,
    question: question.title,
    options: question.options?.map((label) => ({ label })),
  }));
  if (item.questionAnswers)
    return (
      <QuestionRecord
        questions={questions}
        answers={Object.fromEntries(
          item.questionAnswers.map((text, index) => [
            String(index),
            { answers: [text] },
          ]),
        )}
      >
        {context}
      </QuestionRecord>
    );
  const form = (
    <UserInputForm
      questions={questions}
      isBlocking={false}
      isCompleted={!!item.questionClosed}
      draftKey={JSON.stringify([s.current?.id, item.id])}
      disabled={!s.connected || s.busy}
      onSubmit={(answers) =>
        sendMessage(
          item.questions
            .map(
              (question, index) =>
                `${question.title}\n回答：${answers[index].answers[0]}`,
            )
            .join("\n\n"),
          [],
          {
            clearDraft: false,
            questionId: item.id,
            questionAnswers: item.questions.map(
              (_, index) => answers[index].answers[0],
            ),
          },
        )
      }
    />
  );
  return item.questionClosed ? (
    <QuestionRecord questions={questions} replyForm={form}>
      {context}
    </QuestionRecord>
  ) : (
    form
  );
}
function Question({ request }) {
  const s = useStore(),
    p = request.params;
  const input = request.method === "item/tool/requestUserInput";
  if (input)
    return (
      <UserInputForm
        questions={p.questions}
        isBlocking={p.isBlocking}
        disabled={!s.connected}
        onSubmit={(answers) => respond(request, { answers })}
      />
    );
  const permission = request.method === "item/permissions/requestApproval";
  const standard = [
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
  ].includes(request.method);
  return (
    <div className="request-card">
      <div className="request-title">
        <Shield size={18} />
        {permission ? "权限请求" : standard ? "等待你的确认" : "客户端工具请求"}
      </div>
      <p>{p.reason || p.command || request.method}</p>
      {permission && <pre>{JSON.stringify(p.permissions, null, 2)}</pre>}
      {standard || permission ? (
        <div className="request-actions">
          <button
            className="secondary"
            onClick={() =>
              respond(
                request,
                permission ? { permissions: {} } : { decision: "decline" },
              )
            }
          >
            拒绝
          </button>
          <button
            className="secondary"
            onClick={() =>
              respond(
                request,
                permission
                  ? { permissions: p.permissions, scope: "session" }
                  : { decision: "acceptForSession" },
              )
            }
          >
            本次会话允许
          </button>
          <button
            className="primary"
            onClick={() =>
              respond(
                request,
                permission
                  ? { permissions: p.permissions, scope: "turn" }
                  : { decision: "accept" },
              )
            }
          >
            允许一次
          </button>
        </div>
      ) : (
        <>
          <p className="muted">
            此工具需要对应客户端提供执行能力。可以取消此请求后继续对话。
          </p>
          <button
            className="secondary"
            onClick={() =>
              respond(request, null, {
                code: -32601,
                message: "当前网页客户端未提供此工具的执行器。",
              })
            }
          >
            取消此请求
          </button>
        </>
      )}
    </div>
  );
}
function ProcessDuration({ timing, working }) {
  const [now, setNow] = useState(Date.now);
  const ticking =
    working &&
    Number.isFinite(timing?.startedAt) &&
    !Number.isFinite(timing?.completedAt) &&
    !Number.isFinite(timing?.durationMs);
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking, timing?.startedAt]);
  const elapsed = turnElapsedMs(timing, working, now);
  if (elapsed === null) return null;
  return (
    <time
      className="process-duration"
      dateTime={`PT${Math.floor(elapsed / 1000)}S`}
    >
      {working ? "已用时 " : "总耗时 "}
      {formatElapsed(elapsed)}
    </time>
  );
}
function ProcessGroup({ group, working, timing, annotations, readOnly, cwd }) {
  const [open, setOpen] = useState(false);
  const latest = group.items.findLast(
    (item) => item.type !== "userInputRequest" && !item.questions?.length,
  );
  const summary =
    latest?.type === "reasoning"
      ? reasoningSummaries(latest.summary).at(-1)
      : null;
  return (
    <div className="process-group">
      <details
        className="process-history"
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="activity-summary">
          {working ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <ListChecks size={15} />
          )}
          <span>{working ? "正在处理" : "工作过程"}</span>
          <ProcessDuration timing={timing} working={working} />
          <small>{group.items.length + group.questions.length} 项</small>
          <ChevronRight className="process-chevron" size={13} />
        </summary>
        {open && (
          <div className="process-content">
            {group.items.map((item) => (
              <Message
                key={item.id}
                item={item}
                annotations={annotations.get(item.id)}
                readOnly={readOnly}
                cwd={cwd}
              />
            ))}
          </div>
        )}
      </details>
      {working && !open && latest && (
        <div className="process-content process-preview">
          {summary ? (
            <ReasoningPart key={latest.id} {...summary} cwd={cwd} />
          ) : (
            <Message
              key={latest.id}
              item={latest}
              annotations={annotations.get(latest.id)}
              readOnly={readOnly}
              cwd={cwd}
            />
          )}
        </div>
      )}
    </div>
  );
}
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
                {!compacting && <small>你可以继续补充要求</small>}
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
export function Composer() {
  const s = useStore(),
    draft = useDraft(),
    area = useRef(),
    files = useRef();
  const annotationDrafts = useAnnotationDrafts(s.current?.id);
  const shortcuts = useComposerShortcuts(area);
  const active = s.active[s.current?.id];
  const compaction = s.compactions[s.current?.id];
  const compacting = isCompacting(compaction);
  function submit() {
    shortcuts.close();
    return submitComposer();
  }
  useEffect(() => {
    if (area.current) {
      area.current.style.height = "auto";
      area.current.style.height =
        Math.min(area.current.scrollHeight, 180) + "px";
    }
  }, [draft, s.threadAccess?.status]);
  async function add(files) {
    for (const file of files)
      try {
        await attachFile(file);
      } catch (e) {
        report(e);
      }
  }
  const token = s.tokenUsage[s.current?.id];
  const usage = token?.last?.totalTokens;
  const windowSize = token?.modelContextWindow;
  const access = s.threadAccess;
  const checking = s.loading || access?.status === "checking";
  const unavailable =
    s.loading ||
    (access && access.status !== "ready" && !(checking && access.background));
  return (
    <div className="composer-wrap">
      {compaction && (
        <CompactionStatus
          key={s.current?.id + compaction.id}
          entry={compaction}
        />
      )}
      {!unavailable && shortcuts.popup}
      {unavailable ? (
        <div
          className="composer-access"
          role="status"
          aria-live="polite"
          aria-busy={checking}
        >
          {checking ? (
            <LoaderCircle size={20} className="spin" />
          ) : (
            <AlertCircle size={20} />
          )}
          <div className="composer-access-content">
            <strong>
              {checking
                ? "正在检查对话状态…"
                : access?.status === "blocked"
                  ? "此对话由另一端使用"
                  : "暂时无法连接此对话"}
            </strong>
            <p>
              {checking
                ? "正在确认是否可以继续发送，历史记录仍可查看。"
                : access?.status === "blocked"
                  ? "历史记录可正常查看。点击“重试”刷新状态，恢复后即可继续发送。"
                  : access?.message}
            </p>
            {(draft || s.attachments.length > 0) && (
              <small>草稿和附件已保留。</small>
            )}
          </div>
          <button
            className="secondary"
            aria-label="重试连接对话"
            disabled={!s.connected || checking}
            onClick={() => refreshThreadAccess()}
          >
            <RefreshCw size={14} />
            {checking ? "正在检查…" : "重试"}
          </button>
        </div>
      ) : (
        <div
          className="composer"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            add(e.dataTransfer.files);
          }}
        >
          <ComposerAnnotations />
          {s.attachments.length > 0 && (
            <div className="attachment-list">
              {s.attachments.map((a) => (
                <div className="attachment" key={a.id}>
                  {a.preview ? (
                    <img src={a.preview} />
                  ) : (
                    <Paperclip size={17} />
                  )}
                  <span>{a.name}</span>
                  <IconButton
                    icon={X}
                    title={"移除 " + a.name}
                    onClick={() =>
                      set({
                        attachments: s.attachments.filter((x) => x.id !== a.id),
                      })
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={area}
            rows={2}
            aria-label="消息"
            aria-autocomplete="list"
            aria-expanded={shortcuts.open}
            aria-activedescendant={
              shortcuts.open ? shortcuts.activeId : undefined
            }
            placeholder={
              compacting
                ? "正在整理上下文…"
                : active
                  ? "补充说明，或等待 Codex 完成…"
                  : "描述任务，@ 引用文件，/ 使用命令…"
            }
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              shortcuts.detect(e.target.value, e.target.selectionStart);
            }}
            onClick={(e) =>
              shortcuts.detect(e.target.value, e.target.selectionStart)
            }
            onKeyUp={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                shortcuts.detect(e.target.value, e.target.selectionStart);
            }}
            onPaste={(e) => {
              const images = [...e.clipboardData.files].filter((f) =>
                f.type.startsWith("image/"),
              );
              if (images.length) {
                e.preventDefault();
                add(images);
              }
            }}
            onKeyDown={(e) => {
              if (shortcuts.keydown(e)) return;
              if (
                e.key === "Enter" &&
                e.ctrlKey &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer-toolbar">
            <div className="composer-tools">
              <input
                type="file"
                ref={files}
                multiple
                hidden
                onChange={(e) => {
                  add(e.target.files);
                  e.target.value = "";
                }}
              />
              <IconButton
                icon={Plus}
                title="添加图片或文本附件"
                onClick={() => files.current.click()}
              />
              <label className="select-control model-select">
                <select
                  aria-label="模型"
                  value={s.model}
                  onChange={(e) => {
                    const m = s.models.find((m) => m.model === e.target.value);
                    selectModel(m);
                  }}
                >
                  {s.models.map((m) => (
                    <option key={m.id} value={m.model}>
                      {m.displayName || m.model}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} />
              </label>
              <ReasoningEffortControl />
              <ServiceTierToggle />
              <IconButton
                icon={ListChecks}
                title="计划模式"
                active={s.mode === "plan"}
                onClick={() =>
                  set({ mode: s.mode === "plan" ? "default" : "plan" })
                }
              />
            </div>
            <div className="send-controls">
              {s.mode === "plan" && <span className="mode-badge">计划</span>}
              {active && (
                <button
                  className="stop-button"
                  aria-label="停止任务"
                  title="停止任务"
                  onClick={() => stop().catch(report)}
                >
                  <Square size={13} fill="currentColor" />
                </button>
              )}
              <button
                className="send-button"
                aria-label="发送消息"
                title="发送消息"
                disabled={
                  !s.connected ||
                  checking ||
                  compacting ||
                  s.busy ||
                  (!draft.trim() &&
                    !s.attachments.length &&
                    !annotationDrafts.length)
                }
                onClick={submit}
              >
                {s.busy ? (
                  <LoaderCircle size={18} className="spin" />
                ) : (
                  <ArrowUp size={19} />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="composer-meta">
        <button
          title={s.projectless ? "未指定项目；可选择文件夹" : s.cwd}
          onClick={() => set({ modal: { type: "directory" } })}
        >
          <Folder size={13} />
          <span>{s.projectless ? "未分类" : basename(s.cwd)}</span>
          <ChevronDown size={11} />
        </button>
        <span className="context-info">
          {usage != null ? (
            <>
              上下文 {usage.toLocaleString()} /{" "}
              {windowSize?.toLocaleString() ?? "—"} tokens
              {windowSize > 0 &&
                `（${Math.round((usage / windowSize) * 100)}%）`}
            </>
          ) : unavailable ? (
            "历史记录可查看"
          ) : (
            "Ctrl + Enter 发送"
          )}
        </span>
      </div>
    </div>
  );
}

function CompactionStatus({ entry }) {
  const s = useStore();
  const working = isCompacting(entry);
  const [checking, setChecking] = useState(false);
  const threadId = s.current?.id;
  useEffect(() => {
    if (!working || !s.connected) return;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      refreshCompaction(threadId).catch(() => {});
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, 5000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [threadId, entry.id, working, s.connected]);
  const titles = {
    starting: "正在提交上下文整理…",
    running: "正在整理上下文…",
    reconnecting: "正在确认整理状态…",
    completed: "上下文整理完成",
    failed: "上下文整理失败",
    interrupted: "上下文整理已中断",
    unconfirmed: "整理结果待确认",
  };
  return (
    <div
      className={"compaction-status " + entry.status}
      role="status"
      aria-live="polite"
      aria-busy={working}
    >
      {working ? (
        <LoaderCircle size={17} className="spin" />
      ) : entry.status === "completed" ? (
        <CheckCircle2 size={17} />
      ) : (
        <AlertCircle size={17} />
      )}
      <div className="compaction-status-content">
        <strong>
          {titles[entry.status]}
          {entry.status === "failed" && entry.error ? `：${entry.error}` : ""}
        </strong>
        <ProcessDuration timing={entry} working={working} />
      </div>
      {entry.status === "reconnecting" ? (
        <button
          className="secondary"
          disabled={!s.connected || checking}
          onClick={async () => {
            setChecking(true);
            try {
              await refreshCompaction(threadId);
            } catch (error) {
              report(error);
            } finally {
              setChecking(false);
            }
          }}
        >
          {checking ? "正在检查…" : "检查状态"}
        </button>
      ) : !working && entry.status !== "completed" ? (
        <button
          className="secondary"
          disabled={!s.connected || !!s.active[s.current?.id]}
          onClick={() => compact().catch(report)}
        >
          重新整理
        </button>
      ) : null}
      {!working && (
        <IconButton
          icon={X}
          title="关闭整理状态"
          onClick={() => {
            const entries = { ...get().compactions };
            delete entries[s.current.id];
            set({ compactions: entries });
          }}
        />
      )}
    </div>
  );
}
