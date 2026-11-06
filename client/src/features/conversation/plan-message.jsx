import React, { useId, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, ListChecks } from "lucide-react";
import { RichText } from "../markdown/rich-text.jsx";
import { IconButton } from "../../ui/primitives.jsx";
import { approvePlan, copy, set, useStore } from "../../store.js";
import { pendingPlan } from "../../domain/plans.js";
import { isCompacting } from "../../domain/compaction.js";

export function PlanMessage({ item, readOnly, cwd }) {
  const s = useStore();
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const threadId = s.current?.id;
  const turns = [
    ...Object.entries(s.turnTimings[threadId] || {}).map(([id, turn]) => ({
      id,
      ...turn,
    })),
    ...(s.turns[threadId] || []),
  ];
  const pending =
    !readOnly &&
    pendingPlan(s.items, turns, s.active[threadId])?.id === item.id;
  const disabled =
    !s.connected ||
    s.busy ||
    s.loading ||
    isCompacting(s.compactions[threadId]) ||
    (s.threadAccess?.threadId === threadId &&
      s.threadAccess.status !== "ready");
  return (
    <article className="message plan-message" aria-label="计划方案">
      <header className="plan-message-header">
        <ListChecks size={17} />
        <strong>计划方案</strong>
        <IconButton
          icon={Copy}
          title="复制计划"
          onClick={() => copy(item.text)}
        />
        <IconButton
          icon={expanded ? ChevronUp : ChevronDown}
          title={expanded ? "收起计划" : "展开计划"}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded(!expanded)}
        />
      </header>
      <div
        id={bodyId}
        className={"plan-message-body" + (expanded ? "" : " is-collapsed")}
      >
        <RichText text={item.text || ""} cwd={cwd} />
      </div>
      {!expanded && (
        <div className="plan-message-expand">
          <button
            aria-expanded={false}
            aria-controls={bodyId}
            onClick={() => setExpanded(true)}
          >
            展开计划
            <ChevronDown size={15} />
          </button>
        </div>
      )}
      {pending && (
        <footer className="plan-message-actions">
          <button
            className="primary"
            disabled={disabled}
            onClick={() => approvePlan(item.id)}
          >
            <Check size={16} />
            批准并执行
          </button>
          <button
            disabled={disabled}
            onClick={() => {
              set({ mode: "plan" });
              document.querySelector('[aria-label="消息"]')?.focus();
            }}
          >
            修改计划
          </button>
        </footer>
      )}
    </article>
  );
}
