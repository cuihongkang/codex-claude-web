import React, { useState, useEffect } from "react";

import { Folder, ChevronRight, ArrowUp, RefreshCw } from "lucide-react";
import { get, rpc } from "../../store.js";
import { IconButton } from "../../ui/primitives.jsx";
export function FolderPicker({ onChoose, initial = get().cwd }) {
  const [path, setPath] = useState(initial),
    [input, setInput] = useState(initial),
    [entries, setEntries] = useState([]),
    [showHidden, setShowHidden] = useState(false),
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
      <label className="directory-options">
        <input
          type="checkbox"
          checked={showHidden}
          onChange={(e) => setShowHidden(e.target.checked)}
        />
        显示隐藏文件夹
      </label>
      {err && <div className="inline-error">{err}</div>}
      <div className="directory-list">
        {loading ? (
          <div className="loading">读取目录…</div>
        ) : (
          entries
            .filter((e) => showHidden || !e.fileName.startsWith("."))
            .map((e) => (
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
