import { BackendBadge } from "./backend-badge.jsx";
import { resourceTarget } from "../../../shared/backend-identity.mjs";
import React, { useState, useEffect, useId } from "react";

import { createPortal } from "react-dom";
import {
  Archive,
  Pin,
  MoreHorizontal,
  Pencil,
  GitBranch,
  ArchiveRestore,
  Minimize2,
  LoaderCircle,
  Trash2,
} from "lucide-react";
import {
  useStore,
  set,
  openThread,
  archive,
  fork,
  compact,
  pin,
  titleOf,
  report,
} from "../store.js";
import { threadTime } from "../domain/thread-order.js";
import { isCompacting } from "../domain/compaction.js";
export function ThreadMenu({ thread, onClose }) {
  const s = useStore();
  const action = (fn) => {
    onClose();
    Promise.resolve().then(fn).catch(report);
  };
  return (
    <div className="dropdown" role="menu">
      <button
        onClick={() => action(() => set({ modal: { type: "rename", thread } }))}
      >
        <Pencil size={14} />
        重命名
      </button>
      <button onClick={() => action(() => pin(thread.id))}>
        <Pin size={14} />
        {s.pins.includes(thread.id) ? "取消置顶" : "置顶对话"}
      </button>
      <button onClick={() => action(() => fork(thread))}>
        <GitBranch size={14} />
        创建分支
      </button>
      <button onClick={() => action(() => archive(thread))}>
        {s.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}{" "}
        {s.archived ? "恢复对话" : "归档对话"}
      </button>
      {s.current?.id === thread.id && (
        <button
          disabled={
            s.busy ||
            !!s.active[thread.id] ||
            isCompacting(s.compactions[thread.id])
          }
          onClick={() => action(compact)}
        >
          <Minimize2 size={14} />
          整理上下文
        </button>
      )}
      <button
        className="danger-action"
        onClick={() => action(() => set({ modal: { type: "delete", thread } }))}
      >
        <Trash2 size={14} />
        删除对话
      </button>
    </div>
  );
}
export function ThreadRow({ thread }) {
  const s = useStore(),
    [menu, show] = useState(false),
    [tooltip, setTooltip] = useState(null);
  const tooltipId = useId();
  const title = titleOf(thread);
  const backendId = resourceTarget(thread.id).backendId;
  const running = !!s.active[thread.id];
  const unread = !!s.unreadCompletions[thread.id];
  const pinned = s.pins.includes(thread.id);
  const status = running
    ? "进行中"
    : unread
      ? "已完成，未读"
      : pinned
        ? "已置顶"
        : null;
  const showTitle = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltip({
      left: rect.left,
      ...(rect.bottom < window.innerHeight / 2
        ? { top: rect.bottom }
        : { bottom: window.innerHeight - rect.top }),
    });
  };
  const titleVisible = !!tooltip;
  useEffect(() => {
    if (!titleVisible) return;
    const dismiss = () => setTooltip(null);
    const onKeyDown = (event) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [titleVisible]);
  const archiveLabel = s.archived ? "恢复对话" : "归档对话";
  const now = Date.now() / 1000,
    diff = now - threadTime(thread);
  const date =
    diff < 3600
      ? Math.max(1, Math.floor(diff / 60)) + "分"
      : diff < 86400
        ? Math.floor(diff / 3600) + "时"
        : new Date(threadTime(thread) * 1000).toLocaleDateString("zh-CN", {
            month: "numeric",
            day: "numeric",
          });
  return (
    <div
      className={
        "thread-row " + (s.current?.id === thread.id ? "selected" : "")
      }
    >
      <button
        className="thread-link"
        aria-describedby={tooltip ? tooltipId : undefined}
        onMouseEnter={showTitle}
        onMouseLeave={() => setTooltip(null)}
        onFocus={showTitle}
        onBlur={() => setTooltip(null)}
        onClick={() => {
          setTooltip(null);
          openThread(thread.id);
        }}
      >
        {status && (
          <span className="thread-status" role="img" aria-label={status}>
            {running ? (
              <LoaderCircle className="spin" size={12} aria-hidden="true" />
            ) : unread ? (
              <span className="thread-completed-dot" />
            ) : (
              <Pin size={12} aria-hidden="true" />
            )}
          </span>
        )}
        <BackendBadge backendId={backendId} />
        <span className="thread-title">{title}</span>
        <small
          title={
            threadTime(thread) === thread.createdAt
              ? "创建时间"
              : "最近活动时间"
          }
        >
          {date}
        </small>
      </button>
      {tooltip &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="thread-title-tooltip"
            style={tooltip}
          >
            {title}
          </div>,
          document.body,
        )}
      <div className="thread-actions">
        <button
          title={archiveLabel}
          aria-label={archiveLabel + " " + titleOf(thread)}
          onClick={() => archive(thread).catch(report)}
        >
          {s.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
        </button>
        <button
          aria-label={"管理对话 " + titleOf(thread)}
          onClick={() => show(!menu)}
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
      {menu && (
        <>
          <div className="click-away" onClick={() => show(false)} />
          <ThreadMenu thread={thread} onClose={() => show(false)} />
        </>
      )}
    </div>
  );
}
