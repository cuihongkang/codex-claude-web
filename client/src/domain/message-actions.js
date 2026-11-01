export function actionableMessages(items, turns, activeTurnId) {
  const lastAnswers = new Map();
  const status = new Map(turns.map((turn) => [turn.id, turn.status]));
  for (const item of items) {
    if (item.type === "agentMessage" && item.turnId)
      lastAnswers.set(item.turnId, item);
  }
  return new Set(
    [...lastAnswers.values()]
      .filter(
        (item) =>
          item.text &&
          item.phase !== "commentary" &&
          item.turnId !== activeTurnId &&
          (status.get(item.turnId) === "completed" ||
            (!status.has(item.turnId) && item.phase === "final_answer")),
      )
      .map((item) => item.id),
  );
}
