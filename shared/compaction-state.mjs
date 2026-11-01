export const isCompacting = (entry) =>
  ["starting", "running", "reconnecting"].includes(entry?.status);

export function findCompactionTurn(entry, turns) {
  return turns.find(
    (turn) =>
      !turn.items?.some((item) => item.type === "userMessage") &&
      (entry.turnId
        ? turn.id === entry.turnId
        : turn.startedAt >= Math.floor(entry.startedAt) &&
          (turn.status === "inProgress" ||
            turn.items?.some((item) => item.type === "contextCompaction"))),
  );
}

export function recoverCompaction(
  entry,
  thread,
  turns,
  now = Date.now() / 1000,
) {
  const turn = findCompactionTurn(entry, turns);
  if (turn)
    return {
      ...entry,
      turnId: turn.id,
      status:
        turn.status === "inProgress"
          ? "running"
          : turn.status === "completed"
            ? "completed"
            : turn.status === "interrupted"
              ? "interrupted"
              : "failed",
      error: turn.error?.message,
      ...(turn.status === "inProgress"
        ? { completedAt: undefined }
        : { completedAt: turn.completedAt ?? now }),
    };
  const ordinaryTurn = turns.some(
    (candidate) =>
      candidate.status === "inProgress" &&
      candidate.items?.some((item) => item.type === "userMessage"),
  );
  if (entry.status === "starting" && !ordinaryTurn) return entry;
  return ["idle", "notLoaded"].includes(thread.status?.type) || ordinaryTurn
    ? { ...entry, status: "unconfirmed", completedAt: now, error: undefined }
    : { ...entry, status: "reconnecting" };
}
