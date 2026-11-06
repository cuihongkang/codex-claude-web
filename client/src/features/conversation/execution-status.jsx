import React, { useEffect, useState } from "react";

export function ExecutionStatus({ status }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!status?.retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status?.retryAt]);
  const seconds = Math.max(0, Math.ceil(((status?.retryAt || 0) - now) / 1000));
  return (
    <div className="working-status" role="status">
      <span className="pulse-dot" />
      {status?.message || "正在工作"}
      {status?.kind === "retrying" &&
        (seconds > 0 ? ` ${seconds} 秒后重试` : "")}
    </div>
  );
}
