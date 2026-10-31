import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  ChevronRight,
  ChevronDown,
  ArrowUp,
  RefreshCw,
  X,
  Save,
  Paperclip,
  Plus,
  TerminalSquare,
  Trash2,
  GitBranch,
  GitPullRequest,
  Copy,
  Search,
  Eye,
  Code,
  FileDiff,
  ArrowUpRight,
} from "lucide-react";
import { CodeEditor } from "./code-editor";
import { isMarkdownFile } from "./editor-language";
import { diffRows, fileChangeHighlights } from "./file-changes";
import { RichText } from "./rich-text";
import { FilePreview } from "./file-preview";
import {
  filePresentation,
  decodeTextFile,
} from "../../server/src/file-types.mjs";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  useStore,
  get,
  set,
  rpc,
  report,
  notice,
  basename,
  b64encode,
  addAttachment,
  uid,
  onEvent,
  copy,
  review,
} from "./store";

export const IconButton = ({
  icon: Icon,
  title,
  onClick,
  active = false,
  ...props
}) => (
  <button
    className={"icon-button" + (active ? " active" : "")}
    title={title}
    aria-label={title}
    onClick={onClick}
    {...props}
  >
    <Icon size={17} />
  </button>
);
export const Empty = ({ icon: Icon = Folder, title, children }) => (
  <div className="empty-state">
    <Icon size={28} strokeWidth={1.3} />
    <strong>{title}</strong>
    {children && <p>{children}</p>}
  </div>
);

export function FolderPicker({ onChoose, initial = get().cwd }) {
  const [path, setPath] = useState(initial),
    [input, setInput] = useState(initial),
    [entries, setEntries] = useState([]),
    [loading, setLoading] = useState(false),
    [err, setErr] = useState("");
  const load = async (p) => {
    setLoading(true);
    setErr("");
    try {
      const r = await rpc("fs/readDirectory", { path: p });
      setPath(p);
      setInput(p);
      setEntries(
        r.entries
          .filter((e) => e.isDirectory)
          .sort((a, b) => a.fileName.localeCompare(b.fileName)),
      );
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load(initial);
  }, []);
  return (
    <>
      <div className="directory-address">
        <IconButton
          icon={ArrowUp}
          title="上一级目录"
          onClick={() => load(path.slice(0, path.lastIndexOf("/")) || "/")}
        />
        <input
          aria-label="目录路径"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(input)}
        />
        <IconButton
          icon={RefreshCw}
          title="打开目录"
          onClick={() => load(input)}
        />
      </div>
      {err && <div className="inline-error">{err}</div>}
      <div className="directory-list">
        {loading ? (
          <div className="loading">读取目录…</div>
        ) : (
          entries.map((e) => (
            <button
              key={e.fileName}
              onClick={() =>
                load((path === "/" ? "" : path) + "/" + e.fileName)
              }
            >
              <Folder size={17} />
              <span>{e.fileName}</span>
              <ChevronRight size={14} />
            </button>
          ))
        )}
      </div>
      <div className="modal-actions">
        <span className="ellipsis">{path}</span>
        <button className="primary" onClick={() => onChoose(path)}>
          选择此目录
        </button>
      </div>
    </>
  );
}

function TreeRow({ entry, path, depth = 0, onOpen }) {
  const [expanded, expand] = useState(false),
    [children, setChildren] = useState(null);
  const full = (path === "/" ? "" : path) + "/" + entry.fileName;
  async function click() {
    if (!entry.isDirectory) {
      onOpen(full);
      return;
    }
    if (!children) {
      try {
        const r = await rpc("fs/readDirectory", { path: full });
        setChildren(
          r.entries.sort(
            (a, b) =>
              Number(b.isDirectory) - Number(a.isDirectory) ||
              a.fileName.localeCompare(b.fileName),
          ),
        );
      } catch (e) {
        report(e);
        return;
      }
    }
    expand(!expanded);
  }
  return (
    <>
      <button
        className="tree-row"
        style={{ paddingLeft: 12 + depth * 15 }}
        onClick={click}
        title={full}
      >
        {entry.isDirectory ? (
          expanded ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )
        ) : (
          <span className="tree-spacer" />
        )}
        {entry.isDirectory ? (
          expanded ? (
            <FolderOpen size={15} />
          ) : (
            <Folder size={15} />
          )
        ) : (
          <FileCode size={15} />
        )}
        <span>{entry.fileName}</span>
      </button>
      {expanded &&
        children?.map((child) => (
          <TreeRow
            key={child.fileName}
            entry={child}
            path={full}
            depth={depth + 1}
            onOpen={onOpen}
          />
        ))}
    </>
  );
}
export function FilePanel() {
  const s = useStore();
  const [entries, setEntries] = useState([]),
    [path, setPath] = useState(s.cwd),
    [file, setFile] = useState(null),
    [text, setText] = useState(""),
    [original, setOriginal] = useState(""),
    [loading, setLoading] = useState(false),
    [filter, setFilter] = useState(""),
    [fileKind, setFileKind] = useState(null),
    [preview, setPreview] = useState(true),
    [change, setChange] = useState(null),
    [fileChange, setFileChange] = useState(null);
  const opening = useRef(0);
  const directoryOpening = useRef(0);
  const markdownFile = file && isMarkdownFile(file);
  const changesMatch = useMemo(
    () =>
      !fileChange ||
      fileChangeHighlights(original, fileChange.diff, fileChange.patches)
        .matches,
    [original, fileChange],
  );
  async function load(p, { navigate = false } = {}) {
    if (
      navigate &&
      file &&
      text !== original &&
      !window.confirm("当前文件有未保存的修改。放弃修改并打开其他目录？")
    )
      return;
    const request = ++directoryOpening.current;
    const target = navigate ? ++opening.current : null;
    const current = () =>
      request === directoryOpening.current &&
      (target === null || target === opening.current);
    setLoading(true);
    try {
      const r = await rpc("fs/readDirectory", { path: p });
      if (!current()) return;
      setEntries(
        r.entries.sort(
          (a, b) =>
            Number(b.isDirectory) - Number(a.isDirectory) ||
            a.fileName.localeCompare(b.fileName),
        ),
      );
      setPath(p);
      if (navigate) {
        setFile(null);
        setFileKind(null);
        setChange(null);
        setFileChange(null);
        setFilter("");
        setText("");
        setOriginal("");
      }
    } catch (e) {
      if (current()) report(e);
    } finally {
      if (request === directoryOpening.current) setLoading(false);
    }
  }
  function returnToFile() {
    opening.current++;
    setChange(null);
  }
  async function open(p, selectedChange = null) {
    if (file === p && text !== original) {
      setFileChange(selectedChange);
      if (selectedChange) setPreview(false);
      returnToFile();
      return;
    }
    if (
      file &&
      text !== original &&
      !window.confirm("当前文件有未保存的修改。放弃修改并打开其他文件？")
    )
      return;
    const request = ++opening.current;
    const presentation = filePresentation(p);
    if (presentation) {
      setFileKind(presentation.kind);
      setFile(p);
      setText("");
      setOriginal("");
      setChange(null);
      setFileChange(null);
      return;
    }
    try {
      const r = await rpc("fs/readFile", { path: p });
      if (request !== opening.current) return;
      const body = decodeTextFile(
        Uint8Array.from(atob(r.dataBase64), (character) =>
          character.charCodeAt(0),
        ),
      );
      setFileKind(body === null ? "download" : null);
      setFile(p);
      setText(body ?? "");
      setOriginal(body ?? "");
      setPreview(!selectedChange);
      setChange(null);
      setFileChange(body === null ? null : selectedChange);
    } catch (e) {
      if (request === opening.current) report(e);
    }
  }
  useEffect(() => {
    if (s.connected) load(s.cwd);
  }, [s.cwd, s.connected]);
  useEffect(() => {
    if (text === original) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [text, original]);
  useEffect(() => {
    if (s.panelFile) {
      if (typeof s.panelFile === "string") open(s.panelFile);
      else if (s.panelFile.view === "directory")
        load(s.panelFile.path, { navigate: true });
      else if (s.panelFile.view === "full") open(s.panelFile.path, s.panelFile);
      else {
        opening.current++;
        setChange(s.panelFile);
      }
      set({ panelFile: null });
    }
  }, [s.panelFile]);
  useEffect(
    () => () => {
      opening.current++;
      directoryOpening.current++;
    },
    [],
  );
  async function save() {
    try {
      await rpc("fs/writeFile", { path: file, dataBase64: b64encode(text) });
      setOriginal(text);
      notice("文件已保存");
    } catch (e) {
      report(e);
    }
  }
  useEffect(() => {
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s" && file) {
        e.preventDefault();
        if (!change && !fileKind) save();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [file, text, change, fileKind]);
  return (
    <>
      <div className="panel-heading">
        <span>
          <Folder size={15} /> 文件
        </span>
        <div>
          <IconButton
            icon={RefreshCw}
            title="刷新文件"
            onClick={() => load(path)}
          />
          <IconButton
            icon={X}
            title="关闭文件面板"
            onClick={() => set({ panel: null })}
          />
        </div>
      </div>
      {change ? (
        <>
          <div className="file-tab">
            <button onClick={returnToFile}>
              <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
              {file ? "返回文件" : "文件列表"}
            </button>
            <span title={change.path}>{basename(change.path)} · 变更</span>
            <IconButton
              icon={ArrowUpRight}
              title="查看完整文件变更"
              onClick={() => open(change.path, change)}
            />
            <IconButton
              icon={Code}
              title="打开源文件"
              onClick={() => open(change.path)}
            />
            <IconButton
              icon={Copy}
              title="复制文件差异"
              onClick={() => copy(change.diff)}
            />
          </div>
          <div className="file-diff-view" role="region" aria-label="文件变更">
            <div className="file-diff-path">
              {change.oldPath && change.oldPath !== change.path && (
                <>{change.oldPath} → </>
              )}
              {change.path}
            </div>
            <DiffBlock diff={change.diff} />
          </div>
          <div className="file-status">
            {change.path}
            <span>本轮变更</span>
          </div>
        </>
      ) : file ? (
        <>
          <div className="file-tab">
            <button
              onClick={() => {
                if (text === original || window.confirm("放弃未保存的修改？")) {
                  setFile(null);
                  setFileChange(null);
                }
              }}
            >
              <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
              文件列表
            </button>
            <span title={file}>
              {basename(file)}
              {text !== original ? " •" : ""}
            </span>
            {fileChange && (
              <>
                <IconButton
                  icon={FileDiff}
                  title="查看本轮差异片段"
                  onClick={() => {
                    opening.current++;
                    setChange(fileChange);
                  }}
                />
                <IconButton
                  icon={Code}
                  title="打开源文件"
                  onClick={() => open(file)}
                />
              </>
            )}
            {markdownFile && !fileKind && (
              <IconButton
                icon={preview ? Code : Eye}
                title={preview ? "编辑 Markdown 源码" : "预览 Markdown"}
                aria-pressed={preview}
                onClick={() => setPreview(!preview)}
              />
            )}
            <IconButton
              icon={Paperclip}
              title="将文件加入消息"
              onClick={() => {
                addAttachment({
                  id: uid(),
                  name: basename(file),
                  input: {
                    type: "text",
                    text: "请参考本机文件：" + file,
                    text_elements: [],
                  },
                });
                notice("已加入消息附件");
              }}
            />
            {!fileKind && (
              <IconButton
                icon={Save}
                title="保存文件"
                disabled={text === original}
                onClick={save}
              />
            )}
          </div>
          {fileKind ? (
            s.panel === "files" && (
              <FilePreview key={file} path={file} kind={fileKind} />
            )
          ) : markdownFile && preview ? (
            <div
              className="file-markdown-preview"
              aria-label="Markdown 文件预览"
            >
              <RichText
                text={text}
                cwd={file.slice(0, file.lastIndexOf("/")) || "/"}
              />
            </div>
          ) : (
            <CodeEditor
              path={file}
              text={text}
              onChange={setText}
              diff={fileChange?.diff || ""}
              patches={fileChange?.patches}
            />
          )}
          <div className="file-status">
            {file}
            {fileChange && (
              <span
                title={
                  changesMatch
                    ? "绿色为新增内容，红色为只读的删除内容"
                    : "可通过顶部的差异按钮查看本轮记录"
                }
              >
                {changesMatch ? "本轮变更" : "当前内容与本轮记录不同"}
              </span>
            )}
            {text !== original && <b>未保存</b>}
          </div>
        </>
      ) : (
        <>
          <div className="file-location">
            <IconButton
              icon={ArrowUp}
              title="上一级目录"
              onClick={() => load(path.slice(0, path.lastIndexOf("/")) || "/")}
            />
            <span title={path}>{path}</span>
          </div>
          <label className="panel-search">
            <Search size={14} />
            <input
              placeholder="筛选当前目录"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <div className="file-tree">
            {loading ? (
              <div className="loading">读取文件…</div>
            ) : (
              entries
                .filter((e) =>
                  e.fileName.toLowerCase().includes(filter.toLowerCase()),
                )
                .map((e) => (
                  <TreeRow
                    key={path + "/" + e.fileName}
                    entry={e}
                    path={path}
                    onOpen={open}
                  />
                ))
            )}
          </div>
        </>
      )}
    </>
  );
}

export function DiffBlock({ diff }) {
  const rows = diffRows(diff);
  const digits = rows.reduce(
    (width, row) =>
      Math.max(
        width,
        String(row.oldLine ?? "").length,
        String(row.newLine ?? "").length,
      ),
    3,
  );
  return (
    <div
      className="diff-block"
      style={{ "--diff-number-width": `${digits}ch` }}
    >
      {rows.map((row, i) => (
        <div key={i} className={row.className}>
          <span className="diff-number diff-old-number" title="原文件行号">
            {row.oldLine ?? ""}
          </span>
          <span className="diff-number diff-new-number" title="修改后文件行号">
            {row.newLine ?? ""}
          </span>
          <code>{row.text || " "}</code>
        </div>
      ))}
    </div>
  );
}
export function ChangesPanel() {
  const s = useStore();
  const [diff, setDiff] = useState(""),
    [branch, setBranch] = useState(""),
    [err, setErr] = useState(""),
    [loading, setLoading] = useState(false),
    [view, setView] = useState("working");
  async function refresh() {
    setLoading(true);
    setErr("");
    try {
      const results = await Promise.all([
        rpc("command/exec", {
          command: ["git", "-C", s.cwd, "branch", "--show-current"],
        }),
        rpc("command/exec", {
          command: ["git", "-C", s.cwd, "diff", "--no-ext-diff"],
        }),
        rpc("command/exec", {
          command: ["git", "-C", s.cwd, "diff", "--cached", "--no-ext-diff"],
        }),
        rpc("command/exec", {
          command: [
            "git",
            "-C",
            s.cwd,
            "ls-files",
            "--others",
            "--exclude-standard",
          ],
        }),
      ]);
      if (results[0].exitCode !== 0) {
        setErr("当前目录不是 Git 仓库。你仍可以查看本次对话中的文件变更。");
        setDiff("");
        return;
      }
      setBranch(results[0].stdout.trim());
      setDiff(
        results[1].stdout +
          results[2].stdout +
          (results[3].stdout ? "\n未跟踪文件：\n" + results[3].stdout : ""),
      );
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, [s.cwd]);
  const chatDiff =
    s.diffs[s.current?.id] ||
    s.items
      .filter((i) => i.type === "fileChange")
      .flatMap((i) => i.changes || [])
      .map((c) => "diff " + c.path + "\n" + c.diff)
      .join("\n");
  const text = view === "working" ? diff : chatDiff;
  return (
    <>
      <div className="panel-heading">
        <span>
          <GitBranch size={15} /> 变更
        </span>
        <div>
          <IconButton icon={RefreshCw} title="刷新变更" onClick={refresh} />
          <IconButton
            icon={X}
            title="关闭变更面板"
            onClick={() => set({ panel: null })}
          />
        </div>
      </div>
      <div className="panel-tabs">
        <button
          className={view === "working" ? "selected" : ""}
          onClick={() => setView("working")}
        >
          工作区
        </button>
        <button
          className={view === "chat" ? "selected" : ""}
          onClick={() => setView("chat")}
        >
          本次对话
        </button>
        <span>
          <GitBranch size={12} />
          {branch}
        </span>
      </div>
      {view === "working" && err && <div className="panel-note">{err}</div>}
      <div className="diff-scroll">
        {loading ? (
          <div className="loading">读取变更…</div>
        ) : text ? (
          <DiffBlock diff={text} />
        ) : (
          <Empty icon={GitPullRequest} title="没有待查看的变更">
            Codex 修改文件后，可以在这里检查差异。
          </Empty>
        )}
      </div>
      <div className="panel-bottom">
        <button className="secondary" onClick={() => review().catch(report)}>
          <GitPullRequest size={15} />
          审查未提交的更改
        </button>
        <IconButton icon={Copy} title="复制差异" onClick={() => copy(text)} />
      </div>
    </>
  );
}

export function TerminalPanel() {
  const s = useStore(),
    host = useRef(),
    term = useRef(),
    fit = useRef(),
    pid = useRef(localStorage.getItem("cx-terminal")),
    observer = useRef();
  const [connected, connectedSet] = useState(false),
    [sessionName, setSessionName] = useState("zsh");
  useEffect(() => {
    const typography = () => {
      const style = getComputedStyle(host.current);
      const fontSize = parseFloat(style.fontSize);
      return { fontSize, lineHeight: parseFloat(style.lineHeight) / fontSize };
    };
    const t = new Terminal({
      ...typography(),
      fontFamily: '"JetBrains Mono",Consolas,monospace',
      cursorBlink: true,
      convertEol: false,
      theme: {
        background: "#ffffff",
        foreground: "#252523",
        cursor: "#252523",
        cursorAccent: "#ffffff",
        selectionBackground: "#c9ddf5",
        black: "#252523",
        red: "#b42318",
        green: "#28713e",
        yellow: "#876300",
        blue: "#205caa",
        magenta: "#8b3e96",
        cyan: "#087d8b",
        white: "#6b6b67",
        brightBlack: "#666660",
        brightRed: "#d12f23",
        brightGreen: "#27803e",
        brightYellow: "#916500",
        brightBlue: "#2769c2",
        brightMagenta: "#a546b0",
        brightCyan: "#098392",
        brightWhite: "#777772",
      },
      scrollback: 5000,
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(host.current);
    f.fit();
    term.current = t;
    fit.current = f;
    const stop = onEvent((m) => {
      if (
        m.method === "command/exec/outputDelta" &&
        m.params.processId === pid.current
      )
        t.write(
          Uint8Array.from(atob(m.params.deltaBase64), (c) => c.charCodeAt(0)),
        );
      if (
        m.method === "lan/state" &&
        pid.current &&
        m.params.terminals?.[pid.current]
      ) {
        t.reset();
        t.write(m.params.terminals[pid.current].buffer || "");
        connectedSet(m.params.terminals[pid.current].running);
      }
    });
    t.onData((data) => {
      if (pid.current)
        rpc("command/exec/write", {
          processId: pid.current,
          deltaBase64: b64encode(data),
        }).catch(report);
    });
    observer.current = new ResizeObserver(() => {
      const { fontSize, lineHeight } = typography();
      if (t.options.fontSize !== fontSize) t.options.fontSize = fontSize;
      if (t.options.lineHeight !== lineHeight)
        t.options.lineHeight = lineHeight;
      f.fit();
      if (pid.current)
        rpc("command/exec/resize", {
          processId: pid.current,
          size: { cols: t.cols, rows: t.rows },
        }).catch(() => {});
    });
    observer.current.observe(host.current);
    const existing = get().terminals?.[pid.current];
    if (existing?.running) {
      t.write(existing.buffer || "");
      connectedSet(existing.running);
    } else spawn(t, f);
    return () => {
      stop();
      observer.current.disconnect();
      t.dispose();
    };
  }, []);
  function spawn(t = term.current, f = fit.current) {
    pid.current = "terminal-" + uid();
    const sessionId = pid.current;
    localStorage.setItem("cx-terminal", pid.current);
    t.reset();
    f.fit();
    connectedSet(true);
    setSessionName(basename(get().cwd) + " — zsh");
    rpc(
      "command/exec",
      {
        command: ["/usr/bin/zsh", "-l"],
        env: { TERM: "xterm-256color", COLORTERM: "truecolor" },
        cwd: get().cwd,
        processId: pid.current,
        tty: true,
        size: { cols: t.cols, rows: t.rows },
        disableTimeout: true,
        disableOutputCap: true,
      },
      0,
    )
      .then(() => {
        if (pid.current === sessionId) connectedSet(false);
      })
      .catch((e) => {
        if (pid.current !== sessionId) return;
        connectedSet(false);
        t.write("\r\n" + e.message + "\r\n");
      });
  }
  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <span>
          <TerminalSquare size={14} />
          终端 <small>{sessionName}</small>
        </span>
        <div>
          <IconButton
            icon={Plus}
            title="重新启动终端"
            onClick={() => {
              if (connected)
                rpc("command/exec/terminate", { processId: pid.current }).catch(
                  report,
                );
              spawn();
            }}
          />
          <IconButton
            icon={Trash2}
            title="结束终端进程"
            onClick={() =>
              rpc("command/exec/terminate", { processId: pid.current }).catch(
                report,
              )
            }
          />
          <IconButton
            icon={X}
            title="隐藏终端"
            onClick={() => set({ terminalOpen: false })}
          />
        </div>
      </div>
      <div ref={host} className="terminal-view" />
    </div>
  );
}
