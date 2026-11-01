import { reasoningSummaries } from "./reasoning-summary.js";
import { asyncQuestionState } from "./question-state.js";

// 每轮活动合并为一个过程区域，运行中的待答卡片独立显示，结束提问收入过程。
export function conversationGroups(items, requests = [], turns = []) {
  const { answered, responses } = asyncQuestionState(items);
  const closedTurns = new Set(
    turns
      .filter(
        (turn) =>
          ["completed", "failed", "interrupted"].includes(turn.status) ||
          Number.isFinite(turn.completedAt),
      )
      .map((turn) => turn.id),
  );
  for (const item of items)
    if (
      item.turnId &&
      item.type === "agentMessage" &&
      item.phase === "final_answer" &&
      !item.questions?.length
    )
      closedTurns.add(item.turnId);
  const requestIds = new Set(requests.map((request) => String(request.id)));
  const lastInTurn = new Map();
  for (const item of items)
    if (item.turnId && !responses.has(item.id))
      lastInTurn.set(item.turnId, item.id);
  const groups = [];
  const processes = new Map();
  function processFor(item) {
    let process = processes.get(item.turnId);
    // 无轮次信息的历史活动仅合并相邻记录，避免跨任务聚合。
    if (!item.turnId && groups.at(-1) !== process) process = null;
    if (!process) {
      process = {
        type: "process",
        id: "process-" + (item.turnId || item.id),
        turnId: item.turnId,
        items: [],
        questions: [],
      };
      processes.set(item.turnId, process);
      const final = item.turnId
        ? groups.findIndex(
            (group) =>
              group.type === "message" &&
              group.item.turnId === item.turnId &&
              group.item.type === "agentMessage",
          )
        : -1;
      if (final >= 0) groups.splice(final, 0, process);
      else {
        const previous = item.turnId
          ? groups.findLastIndex(
              (group) => (group.turnId || group.item?.turnId) === item.turnId,
            )
          : -1;
        groups.splice(previous >= 0 ? previous + 1 : groups.length, 0, process);
      }
    }
    return process;
  }
  for (const item of items) {
    if (responses.has(item.id)) continue;
    if (
      item.type === "userInputRequest" &&
      requestIds.has(String(item.request.id))
    )
      continue;
    if (item.type === "reasoning" && !reasoningSummaries(item.summary).length)
      continue;
    const question = item.type === "agentMessage" && !!item.questions?.length;
    if (item.type === "agentMessage" && !item.text?.trim() && !question)
      continue;
    const answer =
      !question &&
      item.type === "agentMessage" &&
      (item.phase === "final_answer" ||
        (item.phase !== "commentary" &&
          lastInTurn.get(item.turnId) === item.id));
    if (question && !answered.has(item.id) && !closedTurns.has(item.turnId)) {
      processFor(item).questions.push({ type: "message", id: item.id, item });
    } else if (item.type === "userMessage" || answer) {
      groups.push({ type: "message", id: item.id, item });
      const process = item.turnId && processes.get(item.turnId);
      if (item.type === "userMessage" && process) {
        groups.splice(groups.indexOf(process), 1);
        groups.push(process);
      }
    } else {
      processFor(item).items.push(
        question
          ? {
              ...item,
              questionAnswers: answered.get(item.id),
              questionClosed: closedTurns.has(item.turnId),
            }
          : item,
      );
    }
  }
  for (const request of requests) {
    const turnId = request.params?.turnId;
    let process = processes.get(turnId);
    if (!process) {
      process = processFor({ id: `user-input-${request.id}`, turnId });
    }
    process.questions.push({
      type: "request",
      id: `request-${request.id}`,
      turnId,
      request,
    });
  }
  return groups.flatMap((group) =>
    group.type === "process" ? [group, ...group.questions] : [group],
  );
}
