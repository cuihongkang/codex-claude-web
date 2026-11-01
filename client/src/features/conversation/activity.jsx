import React, { useState } from "react";

import {
  ChevronDown,
  ChevronRight,
  Check,
  TerminalSquare,
  FileCode,
  Globe,
  Brain,
  LoaderCircle,
  Sparkles,
  AlertCircle,
  Users,
  ImageIcon,
} from "lucide-react";
import { get, set, openSubAgent } from "../../store.js";
import { DiffBlock } from "../../ui/diff-block.jsx";
import { reasoningSummaries } from "../../domain/reasoning-summary.js";
import { useSummaryTranslation } from "./use-summary-translation.js";
import { ActivityContent } from "./activity-content.jsx";
import { activityLabel, activityHasImage } from "../../domain/activity.js";
import { RichText } from "../markdown/rich-text.jsx";
import {
  isSubAgentItem,
  subAgentAction,
  subAgents,
} from "../../domain/sub-agents.js";
export function Activity({ item, cwd }) {
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
export function Reasoning({ item, cwd }) {
  return reasoningSummaries(item.summary).map((summary, index) => (
    <ReasoningPart key={index} {...summary} cwd={cwd} />
  ));
}
export function ReasoningPart({ title, body, cwd }) {
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
