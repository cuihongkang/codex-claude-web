import React, { useState, useEffect, useRef } from "react";
import { fileReferenceInput } from "./user-message.js";
import {
  FileCode,
  Folder,
  Sparkles,
  SquarePen,
  Brain,
  ListChecks,
  GitPullRequest,
  Minimize2,
  TerminalSquare,
  Search,
  Settings,
  GitBranch,
  Square,
  ChevronRight,
  LoaderCircle,
  Pencil,
  Trash2,
} from "lucide-react";
import * as store from "./store";

import {
  composerCommands,
  commandAvailable,
  runComposerCommand,
  absolutePath as absolute,
} from "./composer-commands";

const icons = {
  init: FileCode,
  new: SquarePen,
  model: Brain,
  plan: ListChecks,
  goal: ListChecks,
  review: GitPullRequest,
  compact: Minimize2,
  skills: Sparkles,
  files: Folder,
  diff: GitBranch,
  terminal: TerminalSquare,
  project: Folder,
  search: Search,
  status: Settings,
  fork: GitBranch,
  rename: Pencil,
  delete: Trash2,
  stop: Square,
};
const commands = composerCommands.map((command) => ({
  ...command,
  icon: icons[command.id] || Settings,
}));
export function useComposerShortcuts(area) {
  const s = store.useStore();
  const draft = store.useDraft();
  const [trigger, setTrigger] = useState(null),
    [files, setFiles] = useState([]),
    [index, setIndex] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const list = useRef(),
    generation = useRef(0);
  function detect(text, position) {
    const before = text.slice(0, position),
      match = before.match(/(^|\s)([@/])([^\s@]*)$/);
    setTrigger(
      match && (match[2] !== "/" || !before.slice(0, match.index).trim())
        ? {
            kind: match[2],
            query: match[3],
            start: position - match[3].length - 1,
            end: position,
          }
        : null,
    );
    setIndex(0);
  }
  useEffect(() => {
    if (s.connected) store.loadSkills().catch(() => {});
  }, [s.cwd, s.connected]);
  useEffect(() => {
    const n = ++generation.current;
    setFiles([]);
    setError("");
    if (trigger?.kind !== "@") {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        let rows;
        const q = trigger.query;
        if (!q || q.endsWith("/")) {
          const directory = q ? absolute(q, s.cwd) : s.cwd;
          const result = await store.rpc("fs/readDirectory", {
            path: directory,
          });
          rows = result.entries
            .sort(
              (a, b) =>
                Number(b.isDirectory) - Number(a.isDirectory) ||
                a.fileName.localeCompare(b.fileName),
            )
            .map((e) => ({
              path: absolute(e.fileName, directory),
              name: e.fileName,
              directory: e.isDirectory,
            }));
        } else {
          const result = await store.rpc("fuzzyFileSearch", {
            query: q,
            roots: [s.cwd],
          });
          rows = result.files.map((f) => ({
            path: absolute(f.path, f.root),
            name: f.file_name,
            directory: f.match_type === "directory",
          }));
        }
        if (n === generation.current) setFiles(rows.slice(0, 60));
      } catch (e) {
        if (n === generation.current) setError(e.message);
      } finally {
        if (n === generation.current) setLoading(false);
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [trigger?.kind, trigger?.query, s.cwd]);
  useEffect(() => {
    if (!draft) setTrigger(null);
  }, [draft]);
  useEffect(() => {
    setTrigger(null);
  }, [s.current?.id]);
  const q = trigger?.query.toLowerCase() || "";
  const matchingSkills = s.skills
    .filter((skill) =>
      (skill.name + " " + skill.description).toLowerCase().includes(q),
    )
    .map((skill) => ({
      id: "skill:" + skill.path,
      kind: "skill",
      label: skill.name,
      description: skill.shortDescription || skill.description,
      icon: Sparkles,
      skill,
    }));
  const items =
    trigger?.kind === "/"
      ? [
          ...commands
            .filter(
              (c) =>
                commandAvailable(c, s) &&
                (c.id + " " + c.label + " " + c.description)
                  .toLowerCase()
                  .includes(q),
            )
            .map((c) => ({ ...c, kind: "command" })),
          ...matchingSkills,
        ]
      : trigger?.kind === "@"
        ? [
            ...files.map((file) => ({
              id: file.path,
              kind: "file",
              label: file.name,
              description: file.path.startsWith(s.cwd + "/")
                ? file.path.slice(s.cwd.length + 1)
                : file.path,
              icon: file.directory ? Folder : FileCode,
              file,
            })),
            ...matchingSkills,
          ]
        : [];
  const selected = Math.min(index, Math.max(0, items.length - 1));
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, items.length]);
  function choose(item) {
    if (!item || !trigger) return;
    const t = trigger,
      text = store.get().draft;
    if (item.kind === "command") {
      const commandText = "/" + item.id + text.slice(t.end);
      store.setDraft(commandText);
      setTrigger(null);
      setIndex(0);
      area.current?.focus();
      runComposerCommand(commandText).catch(store.report);
      return;
    }
    let replacement = "";
    if (item.kind === "file") {
      const file = item.file;
      replacement = "@" + file.name + " ";
      store.addAttachment({
        id: store.uid(),
        name: file.name,
        input: fileReferenceInput(file),
      });
    }
    if (item.kind === "skill") {
      store.addAttachment({
        id: store.uid(),
        name: item.skill.name,
        input: { type: "skill", name: item.skill.name, path: item.skill.path },
      });
    }
    store.setDraft(text.slice(0, t.start) + replacement + text.slice(t.end));
    setTrigger(null);
    setIndex(0);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(
        t.start + replacement.length,
        t.start + replacement.length,
      );
    });
  }
  function keydown(e) {
    if (!trigger || e.nativeEvent.isComposing || e.ctrlKey || e.metaKey)
      return false;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setTrigger(null);
      return true;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setIndex(
        (selected + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
          Math.max(1, items.length),
      );
      return true;
    }
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
      e.preventDefault();
      if (items.length) choose(items[selected]);
      return true;
    }
    return false;
  }
  const popup = trigger && (
    <div className="shortcut-popover">
      <div className="shortcut-heading">
        <span>
          {trigger.kind === "@" ? "引用文件、目录或技能" : "快捷命令与技能"}
        </span>
        <small>{trigger.kind === "@" ? store.basename(s.cwd) : "/"}</small>
      </div>
      <div
        className="shortcut-options"
        role="listbox"
        aria-label={trigger.kind === "@" ? "引用建议" : "快捷命令"}
        ref={list}
      >
        {items.map((item, i) => (
          <button
            role="option"
            aria-selected={selected === i}
            id={"shortcut-option-" + i}
            className={selected === i ? "selected" : ""}
            key={item.id}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setIndex(i)}
            onClick={() => choose(item)}
          >
            <span className="shortcut-icon">
              <item.icon size={17} />
            </span>
            <span>
              <b>{item.kind === "command" ? "/" + item.id : item.label}</b>
              <small>
                {item.kind === "command"
                  ? item.label + " · " + item.description
                  : item.description}
              </small>
            </span>
            {item.kind === "skill" ? (
              <em>技能</em>
            ) : item.kind === "file" && item.file.directory ? (
              <em>目录</em>
            ) : (
              <ChevronRight size={12} />
            )}
          </button>
        ))}
        {loading && (
          <div className="shortcut-empty">
            <LoaderCircle size={14} className="spin" />
            搜索项目文件…
          </div>
        )}
        {!loading && !items.length && (
          <div className="shortcut-empty">
            {error || "没有匹配项，继续输入以搜索。"}
          </div>
        )}
      </div>
      <div className="shortcut-footer">
        <span>↑ ↓ 选择 · Enter / Tab 确认</span>
        <span>Esc 关闭</span>
      </div>
    </div>
  );
  return {
    popup,
    open: !!trigger,
    activeId: items.length ? "shortcut-option-" + selected : undefined,
    detect,
    close: () => setTrigger(null),
    keydown,
  };
}
