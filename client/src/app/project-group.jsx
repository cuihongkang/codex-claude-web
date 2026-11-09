import React, { useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  MessageSquare,
  Pin,
  Plus,
} from "lucide-react";
import {
  basename,
  newChat,
  toggleProjectPin,
  moveThreadToFolder,
  report,
} from "../store.js";
import { IconButton } from "../ui/primitives.jsx";

export function ProjectGroup({ path, pinned = false, children }) {
  const [open, expand] = useState(pinned);
  const [dragOver, setDragOver] = useState(false);
  const [moving, setMoving] = useState(false);
  const [showAll, revealAll] = useState(false);
  useEffect(() => {
    if (!dragOver) return;
    const clear = () => setDragOver(false);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, [dragOver]);
  const conversations = React.Children.toArray(children);
  const label = path ? basename(path) : "未分类";
  return (
    <div className="project-group">
      <div
        className={"project-heading" + (dragOver ? " drop-target" : "")}
        aria-busy={moving}
        onDragOver={(event) => {
          if (
            moving ||
            !event.dataTransfer.types.includes("application/x-claudex-thread")
          )
            return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDragOver(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setDragOver(false);
        }}
        onDrop={async (event) => {
          setDragOver(false);
          const id = event.dataTransfer.getData("application/x-claudex-thread");
          if (!id || moving) return;
          event.preventDefault();
          setMoving(true);
          try {
            await moveThreadToFolder(id, path);
            expand(true);
            revealAll(true);
          } catch (error) {
            report(error);
          } finally {
            setMoving(false);
          }
        }}
      >
        <button
          title={path || "未指定项目的对话"}
          aria-expanded={open}
          onClick={() => expand(!open)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {path ? <Folder size={14} /> : <MessageSquare size={14} />}
          <span>{label}</span>
        </button>
        {path && (
          <IconButton
            icon={Pin}
            title={(pinned ? "取消固定 " : "固定 ") + label}
            active={pinned}
            aria-pressed={pinned}
            onClick={() => toggleProjectPin(path)}
          />
        )}
        <IconButton
          icon={Plus}
          title={"在 " + label + " 中新建对话"}
          onClick={() => newChat(path)}
        />
      </div>
      {open && (
        <>
          {showAll ? conversations : conversations.slice(0, 5)}
          {conversations.length > 5 && (
            <button
              className="project-more"
              aria-label={(showAll ? "收起 " : "查看更多 ") + label + " 的对话"}
              aria-expanded={showAll}
              onClick={() => revealAll(!showAll)}
            >
              {showAll ? "收起" : `查看更多（${conversations.length - 5}）`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
