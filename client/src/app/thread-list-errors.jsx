import React from "react";

export function ThreadListErrors({ errors = [], onRetry, loading = false }) {
  if (!errors.length) return null;
  return (
    <div className="inline-error" role="alert">
      {errors.map((error, index) => (
        <p key={error.backendId || index}>
          {error.backendId === "claude"
            ? "Claude Code"
            : error.backendId === "codex"
              ? "Codex"
              : "对话"}
          读取失败：{error.message}
        </p>
      ))}
      <button
        type="button"
        className="secondary"
        disabled={loading}
        onClick={onRetry}
      >
        重试
      </button>
    </div>
  );
}
