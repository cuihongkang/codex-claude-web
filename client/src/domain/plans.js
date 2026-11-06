// 计划正文来自后端消息；步骤进度 turn/plan/updated 独立于待批准的方案。
export function pendingPlan(items, turns = [], activeTurnId) {
  const lastUser = items.findLast((item) => item.type === "userMessage");
  const plan = items.findLast(
    (item) => item.type === "plan" && item.text?.trim(),
  );
  if (!plan?.turnId || (lastUser && lastUser.turnId !== plan.turnId))
    return null;
  const turn = turns.find((turn) => turn.id === plan.turnId);
  return !activeTurnId && turn?.status === "completed" ? plan : null;
}

export function planImplementationText(plan) {
  return `Implement the following plan:\n\n${plan.text}`;
}

export function planApprovalLabel(text) {
  return text.startsWith("Implement the following plan:\n\n")
    ? "批准并执行计划"
    : text;
}
