import React, { useState, useEffect } from "react";

import { X, LoaderCircle, CheckCircle2, AlertCircle } from "lucide-react";
import {
  useStore,
  get,
  set,
  compact,
  refreshCompaction,
  report,
} from "../../store.js";
import { IconButton } from "../../ui/primitives.jsx";
import { isCompacting } from "../../domain/compaction.js";
import { ProcessDuration } from "../conversation/process-group.jsx";
export function CompactionStatus({ entry }) {
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
