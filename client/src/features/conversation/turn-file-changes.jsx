import React, { useState, useMemo } from "react";
import {
  FileDiff,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  ArrowUpRight,
  FileCode,
} from "lucide-react";
import { useStore, set, rpc, basename } from "../../store.js";
import { turnFileChanges } from "../../domain/file-changes.js";

export function TurnFileChanges({ turnId, items }) {
  const s = useStore();
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const threadId = s.current.id;
  const turn = s.turns[threadId]?.find((turn) => turn.id === turnId);
  const working =
    s.active[threadId] === turnId || turn?.status === "inProgress";
  const diff = s.turnDiffs[threadId]?.[turnId];
  const cwd = s.current.cwd || s.cwd;
  const files = useMemo(
    () => (working ? [] : turnFileChanges(items, diff, cwd)),
    [working, items, diff, cwd],
  );
  if (!files.length) return null;
  return (
    <section className="turn-file-changes" aria-label="本轮文件变更">
      <button
        className="file-changes-heading"
        aria-label="已编辑文件"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <FileDiff size={15} />
        <span>已编辑文件</span>
        <small>{files.length}</small>
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      <ul
        className="file-changes-list"
        aria-label="已编辑文件列表"
        hidden={!expanded}
      >
        {(showAll ? files : files.slice(0, 5)).map((file) => (
          <FileChange
            key={file.path}
            file={file}
            threadId={threadId}
            turnId={turnId}
          />
        ))}
      </ul>
      {expanded && files.length > 5 && (
        <button
          className="file-changes-more"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "收起列表" : `显示其余 ${files.length - 5} 个文件`}
          {showAll ? (
            <ChevronDown size={12} className="file-changes-less" />
          ) : (
            <ChevronDown size={12} />
          )}
        </button>
      )}
    </section>
  );
}

function FileChange({ file, threadId, turnId }) {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const undone = s.undoneFiles[JSON.stringify([threadId, turnId, file.path])];
  const label =
    file.kind === "add"
      ? "已新增"
      : file.kind === "delete"
        ? "已删除"
        : file.oldPath && file.oldPath !== file.path
          ? "已移动"
          : "已编辑";
  function viewChanges(view = "diff") {
    set({
      panel: "files",
      panelFile: {
        path: file.path,
        oldPath: file.oldPath,
        diff: file.diff,
        patches: file.patches,
        view,
      },
    });
  }
  async function undo() {
    setBusy(true);
    setError("");
    try {
      await rpc("lan/files/undo", { threadId, turnId, path: file.path });
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="file-change-item">
      <div className="file-change-row">
        <button
          className="file-change-name"
          title={file.path}
          aria-label={`${label} ${file.path}`}
          onClick={() => viewChanges()}
        >
          <FileDiff size={14} />
          <span>{basename(file.path)}</span>
        </button>
        <div
          className="file-change-stats"
          aria-label={`新增 ${file.added} 行，删除 ${file.removed} 行`}
        >
          <span className="file-change-added">+{file.added}</span>
          <span className="file-change-removed">-{file.removed}</span>
          {undone && <span className="file-change-undone">已撤销</span>}
        </div>
        <div className="file-change-actions">
          <button
            className="file-change-undo"
            aria-label={`撤销 ${basename(file.path)} 的本轮修改`}
            title={
              undone
                ? "已撤销"
                : file.changes.length
                  ? "撤销此文件在本轮中的修改"
                  : "暂时无法撤销此修改"
            }
            disabled={
              !s.connected ||
              !!s.active[threadId] ||
              busy ||
              undone ||
              !file.changes.length
            }
            onClick={undo}
          >
            {busy ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <RotateCcw size={14} />
            )}
          </button>
          <button
            className="file-change-source"
            title="打开源文件（无变更标记）"
            aria-label={`打开 ${basename(file.path)} 的源文件`}
            onClick={() => set({ panel: "files", panelFile: file.path })}
          >
            <FileCode size={14} />
          </button>
          <button
            className="file-change-view"
            title="打开完整文件并标记变更"
            aria-label={`打开 ${basename(file.path)} 的完整文件并标记变更`}
            onClick={() => viewChanges("full")}
          >
            <ArrowUpRight size={14} />
          </button>
        </div>
      </div>
      {error && (
        <div className="file-change-error" role="alert">
          {error}
        </div>
      )}
    </li>
  );
}
