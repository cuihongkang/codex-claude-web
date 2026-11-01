export function quotaSnapshot(usage) {
  return usage?.rateLimitsByLimitId?.codex || usage?.rateLimits;
}

export function quotaWindows(usage) {
  const limits = quotaSnapshot(usage);
  return [limits?.primary, limits?.secondary].filter(
    (window) => window && Number.isFinite(window.usedPercent),
  );
}

export function quotaLabel(minutes) {
  if (minutes === 10080) return "周额度";
  if (minutes >= 1440) return `${Math.round(minutes / 1440)} 天额度`;
  if (minutes >= 60) return `${minutes / 60} 小时额度`;
  if (minutes > 0) return `${minutes} 分钟额度`;
  return "额度";
}

export function quotaShortLabel(minutes) {
  if (minutes === 10080) return "周";
  if (minutes >= 1440) return `${Math.round(minutes / 1440)}d`;
  if (minutes >= 60) return `${minutes / 60}h`;
  if (minutes > 0) return `${minutes}m`;
  return "";
}

export function quotaRemaining(window) {
  return Math.max(0, Math.min(100, 100 - window.usedPercent));
}

export function quotaPlan(account, usage) {
  const plan = quotaSnapshot(usage)?.planType || account?.planType;
  if (plan)
    return plan.replace(
      /(^|[_-])(\w)/g,
      (_, prefix, c) => `${prefix ? " " : ""}${c.toUpperCase()}`,
    );
  if (account?.type === "apiKey") return "API Key";
  return "";
}

export function quotaResetText(resetsAt, now = Date.now()) {
  if (!resetsAt) return "";
  const remaining = resetsAt * 1000 - now;
  if (remaining <= 0) return "正在更新重置额度…";
  if (remaining < 60000) return "不到 1 分钟后重置";
  const minutes = Math.ceil(remaining / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days) return `${days} 天${hours ? ` ${hours} 小时` : ""}后重置`;
  const rest = minutes % 60;
  if (hours) return `${hours} 小时${rest ? ` ${rest} 分钟` : ""}后重置`;
  return `${minutes} 分钟后重置`;
}

// 滚动通知中的 null 表示字段暂缺；完整读取响应负责清除已移除的窗口。
export function mergeUsageUpdate(usage, incoming) {
  const id =
    incoming.limitId ||
    usage?.rateLimits?.limitId ||
    (usage?.rateLimitsByLimitId?.codex ? "codex" : null);
  const previous =
    (id && usage?.rateLimitsByLimitId?.[id]) ||
    ((!id ||
      id === usage?.rateLimits?.limitId ||
      (id === "codex" && !usage?.rateLimits?.limitId)) &&
      usage?.rateLimits) ||
    {};
  const merged = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null) continue;
    merged[key] =
      typeof value === "object"
        ? {
            ...previous[key],
            ...Object.fromEntries(
              Object.entries(value).filter(([, field]) => field != null),
            ),
          }
        : value;
  }
  return {
    ...usage,
    rateLimits:
      !usage?.rateLimits ||
      !id ||
      id === "codex" ||
      id === usage.rateLimits.limitId
        ? merged
        : usage.rateLimits,
    ...(id && {
      rateLimitsByLimitId: { ...usage?.rateLimitsByLimitId, [id]: merged },
    }),
  };
}
