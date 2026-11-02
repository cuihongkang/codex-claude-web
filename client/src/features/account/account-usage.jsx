import React, { useEffect, useId, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { useStore, set, refreshUsage } from "../../store.js";
import {
  quotaCreditsText,
  quotaLabel,
  quotaPlan,
  quotaRemaining,
  quotaResetText,
  quotaShortLabel,
  quotaWindows,
} from "../../domain/account-usage.js";

function UsageMeters({ usage }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "hidden") setNow(Date.now());
    };
    tick();
    const interval = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return quotaWindows(usage).map((window, index) => {
    const remaining = quotaRemaining(window);
    const label = quotaLabel(window.windowDurationMins);
    return (
      <div
        className="usage-meter"
        data-level={remaining <= 10 ? "low" : "normal"}
        key={index}
      >
        <div>
          <span>{label}</span>
          <b>
            {Math.round(remaining)}% <span>剩余</span>
          </b>
        </div>
        <progress value={remaining} max="100" aria-label={`${label}剩余`} />
        {window.resetsAt && (
          <small className="quota-reset">
            <span>{quotaResetText(window.resetsAt, now)}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={new Date(window.resetsAt * 1000).toISOString()}>
              {new Date(window.resetsAt * 1000).toLocaleString("zh-CN", {
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </time>
          </small>
        )}
      </div>
    );
  });
}

export function AccountFooter() {
  const s = useStore();
  const [expanded, setExpanded] = useState(false);
  const footer = useRef(null);
  const toggle = useRef(null);
  const detailsId = useId();
  useEffect(() => {
    if (!expanded) return;
    const close = (event) => {
      if (footer.current && !footer.current.contains(event.target))
        setExpanded(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [expanded]);
  useEffect(() => setExpanded(false), [s.account?.email, s.account?.type]);
  useEffect(() => {
    if (!s.connected) return;
    const refresh = () => {
      if (document.visibilityState !== "hidden") refreshUsage();
    };
    refresh();
    const interval = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [s.connected]);

  useEffect(() => {
    if (!s.connected) return;
    const resets = quotaWindows(s.usage)
      .map((window) => window.resetsAt * 1000 + 1000)
      .filter((reset) => reset > Date.now());
    if (!resets.length) return;
    const timer = setTimeout(
      () => {
        if (document.visibilityState !== "hidden") refreshUsage();
      },
      Math.min(Math.min(...resets) - Date.now(), 2147483647),
    );
    return () => clearTimeout(timer);
  }, [s.connected, s.usage]);

  const windows = quotaWindows(s.usage);
  const hasWindows = windows.length > 0;
  const credits = quotaCreditsText(s.usage);
  const plan = quotaPlan(s.account, s.usage);
  const apiAccount = s.account && s.account.type !== "chatgpt";
  const stale =
    (s.usageError || !s.connected) && (hasWindows || credits !== null);
  return (
    <div
      className="account-card"
      ref={footer}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.stopPropagation();
          event.preventDefault();
          setExpanded(false);
          toggle.current?.focus();
        }
      }}
    >
      {expanded && (
        <section
          id={detailsId}
          className="account-quota"
          aria-label="账户额度"
          aria-busy={s.usageLoading}
        >
          <div className="account-quota-heading">
            <span>额度</span>
            {stale && (
              <span
                className="quota-stale"
                title={s.usageError || "连接恢复后自动更新额度"}
              >
                待更新
              </span>
            )}
            {plan && <span className="account-plan">{plan}</span>}
          </div>
          <UsageMeters usage={s.usage} />
          {credits !== null && (
            <div className="quota-credits">
              <span>剩余点数</span>
              <b>{credits}</b>
            </div>
          )}
          {!hasWindows && credits === null && (
            <p
              className="quota-empty"
              role="status"
              title={s.usageError || undefined}
            >
              {apiAccount
                ? "当前使用 API 账户"
                : !s.connected
                  ? "连接后自动读取额度"
                  : s.usageError
                    ? "额度暂时不可用"
                    : s.usageLoading || !s.usage
                      ? "正在读取额度…"
                      : "暂无额度数据"}
            </p>
          )}
        </section>
      )}
      <div className="account-row">
        <button
          className="account-button"
          onClick={() => {
            setExpanded(false);
            set({ modal: { type: "settings" } });
          }}
          aria-label="账户与设置"
        >
          <span className="avatar">
            {(s.account?.email || "C").slice(0, 1).toUpperCase()}
          </span>
          <span>
            <b>{s.account?.email?.split("@")[0] || plan || "Codex"}</b>
            <small>
              <i className={s.connected ? "online" : ""} />
              {s.connected ? "已连接" : "正在连接…"}
            </small>
          </span>
        </button>
        {!apiAccount && (
          <button
            ref={toggle}
            className="quota-toggle"
            aria-label={`${expanded ? "收起" : "展开"}额度详情${stale ? "，数据待更新" : ""}`}
            aria-expanded={expanded}
            aria-controls={detailsId}
            title={`${expanded ? "收起" : "查看"}额度详情${stale ? "（待更新）" : ""}`}
            data-stale={stale ? "true" : undefined}
            onClick={() => setExpanded(!expanded)}
          >
            {windows.map((window, index) => {
              const remaining = quotaRemaining(window);
              return (
                <span
                  className="quota-summary"
                  key={index}
                  role="progressbar"
                  aria-label={`${quotaLabel(window.windowDurationMins)}剩余`}
                  aria-valuenow={Math.round(remaining)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  data-level={remaining <= 10 ? "low" : "normal"}
                >
                  <span className="quota-ring">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle
                        className="quota-ring-track"
                        cx="12"
                        cy="12"
                        r="10"
                      />
                      <circle
                        className="quota-ring-fill"
                        cx="12"
                        cy="12"
                        r="10"
                        pathLength="100"
                        strokeDasharray={`${remaining} 100`}
                        transform="rotate(-90 12 12)"
                        opacity={remaining === 0 ? 0 : 1}
                      />
                    </svg>
                    <span>{quotaShortLabel(window.windowDurationMins)}</span>
                  </span>
                  <span className="quota-number">{Math.round(remaining)}%</span>
                </span>
              );
            })}
            {!hasWindows && (
              <span className="quota-summary">
                <span className="quota-ring quota-ring-empty" />
                <span className="quota-number">—</span>
              </span>
            )}
          </button>
        )}
        <button
          className="account-settings"
          aria-label="设置"
          title="设置"
          onClick={() => {
            setExpanded(false);
            set({ modal: { type: "settings" } });
          }}
        >
          <Settings size={17} />
        </button>
      </div>
    </div>
  );
}
