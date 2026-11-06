import React, { useEffect, useState } from "react";
import { useStore, rpc, onEvent, report } from "../../store.js";
import { backendCapability, backendReady } from "../../domain/backends.js";
export function InputQueue() {
  const s = useStore(),
    id = s.current?.id;
  const [entries, setEntries] = useState([]);
  const enabled = backendCapability(s, "inputRecovery") === true;
  const ready = s.connected && backendReady(s);
  useEffect(() => setEntries([]), [enabled, id]);
  useEffect(() => {
    let current = true,
      revision = 0;
    if (!enabled || !id || !ready) return;
    const refresh = () => {
      const request = ++revision;
      return rpc("lan/inputQueue/list", { threadId: id })
        .then((r) => {
          if (current && request === revision) setEntries(r.entries);
        })
        .catch((e) => {
          if (current && request === revision) report(e);
        });
    };
    refresh();
    const stop = onEvent((m) => {
      if (m.method === "lan/inputQueue/updated" && m.params.threadId === id)
        refresh();
    });
    return () => {
      current = false;
      stop();
    };
  }, [enabled, id, ready]);
  return entries.length ? (
    <div className="input-queue" aria-label="待处理输入">
      {entries.map((entry) => (
        <div key={entry.id}>
          <span>
            {entry.status === "uncertain" ? "待核对" : "已排队"}：
            {entry.input
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join(" ")}
          </span>
          {entry.status === "uncertain" && (
            <button
              disabled={!ready}
              onClick={() =>
                rpc("lan/inputQueue/retry", {
                  threadId: id,
                  id: entry.id,
                }).catch(report)
              }
            >
              重试
            </button>
          )}
          <button
            disabled={!ready}
            onClick={() =>
              rpc("lan/inputQueue/cancel", {
                threadId: id,
                id: entry.id,
              }).catch(report)
            }
          >
            取消
          </button>
        </div>
      ))}
    </div>
  ) : null;
}
