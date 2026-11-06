import React, { useState } from "react";

import { PanelLeft, ChevronRight, Plus, MoreHorizontal } from "lucide-react";
import { useStore, set, newChat, titleOf, basename } from "../store.js";
import { IconButton } from "../ui/primitives.jsx";
import { BackendBadge } from "./backend-badge.jsx";
import { currentBackendId } from "../domain/backends.js";
import { ThreadMenu } from "./thread-row.jsx";
export function Header() {
  const s = useStore(),
    [menu, show] = useState(false);
  return (
    <header className="topbar">
      <IconButton
        icon={PanelLeft}
        title="显示侧栏"
        onClick={() => {
          document.body.classList.remove("sidebar-collapsed");
          set({ sidebar: !s.sidebar });
        }}
      />
      <BackendBadge backendId={currentBackendId(s)} />
      <div className="breadcrumb">
        <button
          title={s.projectless ? "未指定项目；可选择文件夹" : s.cwd}
          onClick={() => set({ modal: { type: "directory" } })}
        >
          {s.projectless ? "未分类" : basename(s.cwd)}
        </button>
        <ChevronRight size={13} />
        <span>{s.current ? titleOf(s.current) : "新对话"}</span>
        {s.current && (
          <div className="header-menu">
            <IconButton
              icon={MoreHorizontal}
              title="对话操作"
              onClick={() => show(!menu)}
            />
            {menu && (
              <>
                <div className="click-away" onClick={() => show(false)} />
                <ThreadMenu thread={s.current} onClose={() => show(false)} />
              </>
            )}
          </div>
        )}
      </div>
      <div className="topbar-actions">
        <IconButton
          icon={Plus}
          title="在当前目录新建对话"
          onClick={() => newChat(undefined, { reuseDirectory: true })}
        />
      </div>
    </header>
  );
}
