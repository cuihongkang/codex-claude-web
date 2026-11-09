import { ThreadListErrors } from "./thread-list-errors.jsx";
import React, { useState } from "react";
import {
  PanelLeft,
  SquarePen,
  Search,
  FolderPlus,
  Archive,
  Pin,
  Sparkles,
  Blocks,
} from "lucide-react";
import { useStore, set, newChat, loadThreads, report } from "../store.js";
import { IconButton } from "../ui/primitives.jsx";
import { projectGroups, sortThreads } from "../domain/thread-order.js";
import { ProjectGroup } from "./project-group.jsx";
import { ResizableSidebar } from "./sidebar-resize.jsx";
import { AccountFooter } from "../features/account/account-usage.jsx";
import claudexWebIcon from "../assets/claudex-web.svg";
import { ThreadRow } from "./thread-row.jsx";
export function Sidebar() {
  const s = useStore();
  const [selection, setSelection] = useState({ id: null, retained: false });
  const selectedId = s.current?.id ?? null;
  const retained =
    !!(s.active[selectedId] || s.unreadCompletions[selectedId]) ||
    (selection.id === selectedId && selection.retained);
  if (selection.id !== selectedId || selection.retained !== retained)
    setSelection({ id: selectedId, retained });
  const shortcuts = sortThreads(
    s.threads.filter(
      (t) =>
        s.active[t.id] ||
        s.unreadCompletions[t.id] ||
        (t.id === selectedId && retained),
    ),
  );
  const pinned = s.threads.filter((t) => s.pins.includes(t.id));
  const groups = projectGroups(
    s.threads,
    s.projects,
    s.pins,
    s.projectlessDirectories,
    s.projectlessRoots.length ? s.projectlessRoots : s.projectlessRoot,
    s.projectOrder || [],
  );
  return (
    <>
      <div
        className={"sidebar-backdrop " + (s.sidebar ? "visible" : "")}
        onClick={() => set({ sidebar: false })}
      />
      <ResizableSidebar open={s.sidebar}>
        <div className="sidebar-top">
          <button className="brand" onClick={() => newChat()}>
            <img src={claudexWebIcon} width={24} height={24} alt="" />
            <strong>Claudex</strong>
            <span>Web</span>
          </button>
          <IconButton
            icon={PanelLeft}
            title="收起侧栏"
            onClick={() => {
              set({ sidebar: false });
              document.body.classList.toggle("sidebar-collapsed");
            }}
          />
        </div>
        <nav className="primary-nav">
          <button onClick={() => newChat()}>
            <SquarePen size={17} />
            <span>新对话</span>
            <kbd>⇧ ⌘ O</kbd>
          </button>
          <button onClick={() => set({ modal: { type: "search" } })}>
            <Search size={17} />
            <span>搜索对话</span>
            <kbd>⌘ K</kbd>
          </button>
          <button onClick={() => set({ modal: { type: "skills" } })}>
            <Sparkles size={17} />
            <span>技能</span>
          </button>
          <button onClick={() => set({ modal: { type: "plugins" } })}>
            <Blocks size={17} />
            <span>插件与连接</span>
          </button>
        </nav>
        <div className="sidebar-section-title">
          <span>{s.archived ? "已归档" : "项目与对话"}</span>
          <div>
            <IconButton
              icon={Archive}
              title={s.archived ? "查看最近对话" : "查看归档对话"}
              active={s.archived}
              onClick={() => {
                set({ archived: !s.archived });
                loadThreads().catch(report);
              }}
            />
            <IconButton
              icon={FolderPlus}
              title="添加项目"
              onClick={() => set({ modal: { type: "project" } })}
            />
          </div>
        </div>
        <div className="thread-list">
          <ThreadListErrors
            errors={s.threadListErrors}
            onRetry={() => loadThreads().catch(report)}
          />
          {shortcuts.length > 0 && (
            <div className="project-group running-threads">
              {shortcuts.map((t) => (
                <ThreadRow key={t.id} thread={t} />
              ))}
            </div>
          )}
          {pinned.length > 0 && (
            <div className="project-group">
              <div className="pinned-heading">
                <Pin size={12} />
                置顶
              </div>
              {pinned.map((t) => (
                <ThreadRow key={t.id} thread={t} />
              ))}
            </div>
          )}
          {[...groups].map(([path, threads]) => (
            <ProjectGroup
              key={path}
              path={path}
              pinned={s.projects.includes(path)}
            >
              {threads.map((t) => (
                <ThreadRow key={t.id} thread={t} />
              ))}
            </ProjectGroup>
          ))}
          {!s.threads.length && !s.threadListErrors?.length && (
            <div className="sidebar-empty">
              {s.booting
                ? "正在载入…"
                : s.archived
                  ? "还没有归档的对话"
                  : "创建一段新对话，开始工作。"}
            </div>
          )}
        </div>
        <div className="sidebar-footer">
          <AccountFooter />
        </div>
      </ResizableSidebar>
    </>
  );
}
