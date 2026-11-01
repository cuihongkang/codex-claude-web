import React, { useState, useEffect, useRef } from "react";

import {
  Search,
  ChevronRight,
  MessageSquare,
  LoaderCircle,
} from "lucide-react";
import {
  useStore,
  set,
  openThread,
  listThreads,
  rename,
  deleteThread,
  titleOf,
  report,
} from "../store.js";
import { Empty } from "../ui/primitives.jsx";
export function SearchDialog() {
  const s = useStore();
  const [q, query] = useState(""),
    [results, update] = useState(s.threads),
    [loading, load] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    const n = ++epoch.current;
    const timer = setTimeout(() => {
      load(true);
      listThreads({
        archived: s.archived,
        searchTerm: q || undefined,
      })
        .then((r) => {
          if (n === epoch.current) update(r.slice(0, 60));
        })
        .catch(report)
        .finally(() => {
          if (n === epoch.current) load(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);
  return (
    <>
      <label className="search-input">
        <Search size={20} />
        <input
          autoFocus
          placeholder="按标题或内容搜索对话"
          value={q}
          onChange={(e) => query(e.target.value)}
        />
        {loading && <LoaderCircle size={16} className="spin" />}
      </label>
      <div className="search-results">
        {results.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              set({ modal: null });
              openThread(t.id);
            }}
          >
            <MessageSquare size={17} />
            <span>
              <b>{titleOf(t)}</b>
              <small>{t.cwd}</small>
            </span>
            <ChevronRight size={14} />
          </button>
        ))}
        {!results.length && !loading && (
          <Empty icon={Search} title="没有找到对话" />
        )}
      </div>
    </>
  );
}
export function RenameDialog({ thread }) {
  const [name, update] = useState(titleOf(thread));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        rename(thread, name)
          .then(() => set({ modal: null }))
          .catch(report);
      }}
    >
      <label className="field-label">
        对话名称
        <input
          autoFocus
          value={name}
          onChange={(e) => update(e.target.value)}
        />
      </label>
      <div className="modal-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => set({ modal: null })}
        >
          取消
        </button>
        <button className="primary" disabled={!name.trim()}>
          保存
        </button>
      </div>
    </form>
  );
}
export function DeleteDialog({ thread }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await deleteThread(thread);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <div className="delete-dialog">
      <p>
        删除“<strong>{titleOf(thread)}</strong>”？
      </p>
      <p className="section-description">
        删除后无法从网页恢复此对话。项目文件会保留。
      </p>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => set({ modal: null })}
        >
          取消
        </button>
        <button className="danger-button" disabled={busy} onClick={remove}>
          {busy ? "正在删除…" : "删除对话"}
        </button>
      </div>
    </div>
  );
}
