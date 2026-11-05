import React, { useEffect } from "react";

import { X } from "lucide-react";
import {
  useStore,
  set,
  setProjectDirectory,
  newChat,
  addProject,
} from "../store.js";
import { IconButton } from "../ui/primitives.jsx";
import { FolderPicker } from "../features/workspace/folder-picker.jsx";
import {
  CommandDialog,
  commandTitles,
} from "../features/commands/command-dialog.jsx";
import { SearchDialog, RenameDialog, DeleteDialog } from "./thread-dialogs.jsx";

import { SettingsDialog, ModelDialog } from "./settings-dialogs.jsx";

import { SkillsDialog, PluginsDialog } from "./tool-dialogs.jsx";

export function Modal() {
  const s = useStore();
  useEffect(() => {
    if (
      s.modal?.type === "command" &&
      s.modal.thread &&
      s.modal.thread.id !== s.current?.id
    )
      set({ modal: null });
  }, [s.current?.id, s.modal]);
  if (!s.modal) return null;
  const { type } = s.modal;
  const titles = {
    command: commandTitles[s.modal.view],
    search: "搜索对话",
    rename: "重命名对话",
    delete: "删除对话",
    directory: "选择工作目录",
    project: "添加项目",
    skills: "技能",
    plugins: "插件与连接",
    settings: "设置",
    model: "模型与思考强度",
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) set({ modal: null });
      }}
    >
      <section
        className={"modal modal-" + type}
        role="dialog"
        aria-modal="true"
        aria-label={titles[type]}
      >
        <div className="modal-heading">
          <h2>{titles[type]}</h2>
          <IconButton
            icon={X}
            title="关闭窗口"
            onClick={() => set({ modal: null })}
          />
        </div>
        {type === "command" ? (
          <div
            className="command-dialog"
            key={s.modal.view + (s.modal.thread?.id || "")}
          >
            <CommandDialog modal={s.modal} />
          </div>
        ) : type === "delete" ? (
          <DeleteDialog thread={s.modal.thread} />
        ) : type === "model" ? (
          <ModelDialog />
        ) : type === "search" ? (
          <SearchDialog />
        ) : type === "rename" ? (
          <RenameDialog thread={s.modal.thread} />
        ) : type === "skills" ? (
          <SkillsDialog />
        ) : type === "plugins" ? (
          <PluginsDialog />
        ) : type === "settings" ? (
          <SettingsDialog />
        ) : (
          <FolderPicker
            onChoose={(path) => {
              if (type === "project") addProject(path);
              else if (s.current) newChat(path);
              else setProjectDirectory(path);
              set({ modal: null });
            }}
          />
        )}
      </section>
    </div>
  );
}
