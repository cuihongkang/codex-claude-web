export function turnElapsedMs(timing, working, now) {
  if (Number.isFinite(timing?.durationMs))
    return Math.max(0, timing.durationMs);
  if (!Number.isFinite(timing?.startedAt)) return null;
  const end = Number.isFinite(timing.completedAt)
    ? timing.completedAt * 1000
    : working
      ? now
      : null;
  return end === null ? null : Math.max(0, end - timing.startedAt * 1000);
}

export function formatElapsed(milliseconds) {
  const total = Math.floor(milliseconds / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours) return `${hours}小时${minutes}分${seconds}秒`;
  if (minutes) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}
