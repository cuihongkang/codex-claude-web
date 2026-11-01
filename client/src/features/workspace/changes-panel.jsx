import React, { useState, useEffect } from "react";

import { RefreshCw, X, GitBranch, GitPullRequest, Copy } from "lucide-react";
import { useStore, set, rpc, report, copy, review } from "../../store.js";
import { IconButton, Empty } from "../../ui/primitives.jsx";

import { DiffBlock } from "../../ui/diff-block.jsx";
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
