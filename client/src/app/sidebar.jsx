import React, { useState } from "react";
import { ClaudeSidebar, newClaude } from "../claude.jsx";
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
import { projectGroups } from "../domain/thread-order.js";
import { ProjectGroup } from "./project-group.jsx";
import { ResizableSidebar } from "./sidebar-resize.jsx";
import { AccountFooter } from "../features/account/account-usage.jsx";
import codexWebIcon from "../assets/codex-web.svg";
import { ThreadRow } from "./thread-row.jsx";
export function Sidebar() {
  const s = useStore();
  const [filter, setFilter] = useState("all");
  const pinned = s.threads.filter((t) => s.pins.includes(t.id));
  const groups = projectGroups(
    s.threads,
    s.projects,
    s.pins,
    s.projectlessDirectories,
    s.projectlessRoot,
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
            <img src={codexWebIcon} width={24} height={24} alt="" />
            <strong>Codex + Claude</strong>
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
          <button onClick={newClaude}>
            <SquarePen size={17} />
            <span>新建 Claude 对话</span>
          </button>
          <button onClick={() => newChat()}>
            <SquarePen size={17} />
            <span>新建 Codex 对话</span>
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
          <select
            className="provider-filter"
            aria-label="筛选会话后端"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">全部会话</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
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
          <div hidden={filter === "codex"}>
            <ClaudeSidebar />
          </div>
          <div hidden={filter === "claude"}>
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
            {!s.threads.length && (
              <div className="sidebar-empty">
                {s.booting
                  ? "正在载入…"
                  : s.archived
                    ? "还没有归档的对话"
                    : "创建一段新对话，开始工作。"}
              </div>
            )}
          </div>
        </div>
        <div className="sidebar-footer">
          <AccountFooter />
        </div>
      </ResizableSidebar>
    </>
  );
}
