import { rankFileSuggestions } from "../../domain/file-suggestions.js";
import { matchingSkills as findSkills } from "../../domain/skill-suggestions.js";
import { pathIcon } from "../../ui/path-icon.jsx";
import { referenceMarkdown } from "../../domain/inline-references.js";
import React, { useState, useEffect, useRef } from "react";
import { referenceThreads } from "../../domain/composer-references.js";

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
import * as store from "../../store.js";
import { backendReady, currentBackendId } from "../../domain/backends.js";

import {
  composerCommands,
  nativeComposerCommands,
  commandAvailable,
  runComposerCommand,
  absolutePath as absolute,
} from "./composer-commands.js";

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
  const ready = s.connected && backendReady(s);
  const [trigger, setTrigger] = useState(null),
    [files, setFiles] = useState([]),
    [index, setIndex] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const list = useRef(),
    generation = useRef(0),
    dismissed = useRef(null);
  function detect(text, position) {
    if (
      dismissed.current?.text === text &&
      dismissed.current.position === position
    )
      return;
    dismissed.current = null;
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
    if (ready) store.loadSkills().catch(() => {});
  }, [s.cwd, ready, s.backendId, s.providerId, s.current?.id]);
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
            providerId: s.providerId,
            ...(s.current?.id && { threadId: s.current.id }),
          });
          rows = result.files.map((f) => ({
            path: absolute(f.path, f.root),
            name: f.file_name,
            directory: f.match_type === "directory",
          }));
        }
        if (n === generation.current)
          setFiles(rankFileSuggestions(rows, q, s.cwd).slice(0, 60));
      } catch (e) {
        if (n === generation.current) setError(e.message);
      } finally {
        if (n === generation.current) setLoading(false);
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [
    trigger?.kind,
    trigger?.query,
    s.cwd,
    s.backendId,
    s.providerId,
    s.current?.id,
  ]);
  useEffect(() => {
    if (!draft) setTrigger(null);
  }, [draft]);
  useEffect(() => {
    setTrigger(null);
  }, [s.current?.id]);
  const q = trigger?.query.toLowerCase() || "";
  const pathQuery = trigger?.kind === "@" && /[/\\]/.test(q);
  const matchingSkills = findSkills(pathQuery ? [] : s.skills, q).map(
    (skill) => ({
      id: "skill:" + (skill.path || skill.name),
      kind: "skill",
      label: skill.interface?.displayName || skill.name,
      description:
        skill.interface?.shortDescription ||
        skill.shortDescription ||
        skill.description,
      icon: Sparkles,
      skill,
    }),
  );
  const items =
    trigger?.kind === "/"
      ? [
          ...[
            ...commands,
            ...nativeComposerCommands(s)
              .filter(
                (command) =>
                  !s.skills.some(
                    (skill) => skill.native && skill.name === command.id,
                  ),
              )
              .map((command) => ({
                ...command,
                icon: Sparkles,
              })),
          ]
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
              icon: file.directory
                ? Folder
                : pathIcon(file.path, { literal: true }),
              file,
            })),
            ...matchingSkills,
            ...referenceThreads(
              pathQuery ? [] : s.threads,
              currentBackendId(s),
              s.current?.id,
              q,
            ).map((thread) => ({
              id: "thread:" + thread.id,
              kind: "thread",
              label: thread.name || thread.title || thread.preview || thread.id,
              description: "引用已保存的会话正文",
              icon: SquarePen,
              thread,
            })),
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
    if (item.kind === "skill" && t.kind === "/") {
      if (item.skill.native)
        store.setDraft(
          `/${item.skill.name} ${text.slice(0, t.start)}${text.slice(t.end)}`,
        );
      else {
        store.addAttachment({
          id: store.uid(),
          name: item.skill.name,
          input: {
            type: "skill",
            name: item.skill.name,
            path: item.skill.path,
          },
        });
        store.setDraft(text.slice(0, t.start) + text.slice(t.end));
      }
      setTrigger(null);
      setIndex(0);
      area.current?.focus();
      return;
    }
    let reference;
    if (item.kind === "thread")
      reference = {
        kind: "thread",
        name: item.label,
        path: "thread://" + item.thread.id,
        threadId: item.thread.id,
      };
    if (item.kind === "file")
      reference = {
        kind: item.file.directory ? "directory" : "file",
        name: item.file.name,
        path:
          item.file.path +
          (item.file.directory && !item.file.path.endsWith("/") ? "/" : ""),
      };
    if (item.kind === "skill")
      reference = {
        kind: "skill",
        name: item.skill.name,
        path:
          item.skill.path || "skill://" + encodeURIComponent(item.skill.name),
        native: item.skill.native,
      };
    if (area.current?.insertReference) {
      setTrigger(null);
      setIndex(0);
      area.current.insertReference(reference, t.start, t.end);
      return;
    }
    const replacement = referenceMarkdown(reference) + " ";
    const next = text.slice(0, t.start) + replacement + text.slice(t.end);
    store.setDraft(next);
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
  function complete(item) {
    if (!item || !trigger) return;
    const query =
      item.kind === "file"
        ? item.file.path.startsWith(s.cwd + "/")
          ? item.file.path.slice(s.cwd.length + 1)
          : item.file.path
        : item.skill?.name || item.label;
    const replacement =
      trigger.kind + (item.kind === "command" ? item.id : query);
    if (trigger.query !== query) setFiles([]);
    if (area.current?.replaceText) {
      area.current.replaceText(replacement, trigger.start, trigger.end);
      return;
    }
    const text = store.get().draft;
    const next =
      text.slice(0, trigger.start) + replacement + text.slice(trigger.end);
    const position = trigger.start + replacement.length;
    store.setDraft(next);
    detect(next, position);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(position, position);
    });
  }
  function close() {
    dismissed.current = trigger
      ? { text: store.get().draft, position: trigger.end }
      : null;
    setTrigger(null);
  }
  function keydown(e) {
    if (!trigger || e.nativeEvent.isComposing || e.ctrlKey || e.metaKey)
      return false;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
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
      if (items.length) {
        if (e.key === "Tab") complete(items[selected]);
        else choose(items[selected]);
      }
      return true;
    }
    return false;
  }
  const popup = trigger && (
    <div className="shortcut-popover">
      <div className="shortcut-heading">
        <span>
          {trigger.kind === "@"
            ? "引用文件、目录、技能或会话"
            : "快捷命令与技能"}
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
        <span>↑ ↓ 选择 · Tab 补全 · Enter 确认</span>
        <span>Esc 关闭</span>
      </div>
    </div>
  );
  return {
    popup,
    open: !!trigger,
    activeId: items.length ? "shortcut-option-" + selected : undefined,
    detect,
    close,
    keydown,
  };
}
