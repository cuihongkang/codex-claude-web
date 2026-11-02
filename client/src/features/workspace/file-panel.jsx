import React, { useState, useEffect, useRef, useMemo } from "react";

import {
  Folder,
  ChevronRight,
  ArrowUp,
  RefreshCw,
  X,
  Save,
  Paperclip,
  Copy,
  Search,
  Eye,
  Code,
  FileDiff,
  ArrowUpRight,
  Download,
} from "lucide-react";
import { CodeEditor } from "./code-editor.jsx";
import { isMarkdownFile } from "./editor-language.js";
import { fileChangeHighlights } from "../../domain/file-changes.js";
import { RichText } from "../markdown/rich-text.jsx";
import { FilePreview } from "./file-preview.jsx";
import {
  filePresentation,
  decodeTextFile,
} from "../../../../shared/file-types.mjs";
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
  copy,
} from "../../store.js";
import { IconButton } from "../../ui/primitives.jsx";
import { DiffBlock } from "../../ui/diff-block.jsx";
import { TreeRow } from "./file-tree.jsx";
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
    [fileChange, setFileChange] = useState(null),
    [fileThreadId, setFileThreadId] = useState(s.current?.id),
    [changeThreadId, setChangeThreadId] = useState(s.current?.id);
  const opening = useRef(0);
  const directoryOpening = useRef(0);
  const fileVisible = file && fileThreadId === s.current?.id;
  const changeVisible = change && changeThreadId === s.current?.id;
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
      get().current?.id === s.current?.id &&
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
      setFileThreadId(s.current?.id);
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
      setFileThreadId(s.current?.id);
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
      if (request !== opening.current || get().current?.id !== s.current?.id)
        return;
      const body = decodeTextFile(
        Uint8Array.from(atob(r.dataBase64), (character) =>
          character.charCodeAt(0),
        ),
      );
      setFileKind(body === null ? "download" : null);
      setFileThreadId(s.current?.id);
      setFile(p);
      setText(body ?? "");
      setOriginal(body ?? "");
      setPreview(!selectedChange);
      setChange(null);
      setFileChange(body === null ? null : selectedChange);
    } catch (e) {
      if (request === opening.current && get().current?.id === s.current?.id)
        report(e);
    }
  }
  useEffect(() => {
    opening.current++;
    directoryOpening.current++;
    setFilter("");
    if (s.connected) load(s.cwd);
  }, [s.current?.id, s.cwd, s.connected]);
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
        setChangeThreadId(s.current?.id);
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
    const request = opening.current;
    try {
      await rpc("fs/writeFile", { path: file, dataBase64: b64encode(text) });
      if (request !== opening.current) return;
      setOriginal(text);
      notice("文件已保存");
    } catch (e) {
      if (request === opening.current) report(e);
    }
  }
  useEffect(() => {
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s" && fileVisible) {
        e.preventDefault();
        if (!changeVisible && !fileKind) save();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [file, text, changeVisible, fileVisible, fileKind]);
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
      {changeVisible ? (
        <>
          <div className="file-tab">
            <button onClick={returnToFile}>
              <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
              {fileVisible ? "返回文件" : "文件列表"}
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
      ) : fileVisible ? (
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
            <a
              className="file-download"
              href={
                "/api/files?" +
                new URLSearchParams({ path: file, download: "1" })
              }
              download={basename(file)}
              title="下载文件"
              aria-label="下载文件"
            >
              <Download size={17} aria-hidden="true" />
            </a>
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
