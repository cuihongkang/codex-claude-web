import React, { useState, useEffect } from "react";

import {
  ChevronRight,
  LoaderCircle,
  ListChecks,
  MessageSquare,
} from "lucide-react";

import { reasoningSummaries } from "../../domain/reasoning-summary.js";
import { turnElapsedMs, formatElapsed } from "../../domain/turn-timing.js";
import { ReasoningPart } from "./activity.jsx";
import { userMessageText } from "../../domain/user-message.js";
import { Content } from "./user-content.jsx";
import { Message } from "./message.jsx";
export function ProcessDuration({ timing, working }) {
  const [now, setNow] = useState(Date.now);
  const ticking = working && Number.isFinite(timing?.startedAt);
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
export function ProcessGroup({
  group,
  working,
  timing,
  annotations,
  readOnly,
  cwd,
}) {
  const [open, setOpen] = useState(false);
  const latest = group.items.findLast(
    (item) =>
      item.type !== "userMessage" &&
      item.type !== "userInputRequest" &&
      !item.questions?.length,
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
            {group.items.map((item) =>
              item.type === "userMessage" ? (
                <details
                  className="activity supplemental-message"
                  key={item.id}
                >
                  <summary className="activity-summary">
                    <MessageSquare size={15} />
                    <span className="supplemental-preview">
                      {userMessageText(item.content) || "附件"}
                    </span>
                    {item.optimistic && <small>发送中</small>}
                    <ChevronRight className="summary-chevron" size={13} />
                  </summary>
                  <div className="activity-body">
                    <Content content={item.content} cwd={cwd} />
                  </div>
                </details>
              ) : (
                <Message
                  key={item.id}
                  item={item}
                  annotations={annotations.get(item.id)}
                  readOnly={readOnly}
                  cwd={cwd}
                />
              ),
            )}
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
