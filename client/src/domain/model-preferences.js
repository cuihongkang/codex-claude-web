const effortOrder = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

// 保留可用强度；缺失档位按强度顺序选择最近值，等距时使用较低档。
export function compatibleEffort(effort, model) {
  const options = model?.supportedReasoningEfforts || [];
  if (!options.length) return effort || model?.defaultReasoningEffort || "";
  if (options.some((option) => option.reasoningEffort === effort))
    return effort;
  if (!effort)
    return model.defaultReasoningEffort || options[0].reasoningEffort;
  const index = effortOrder.indexOf(effort);
  const supported = options
    .map((option) => option.reasoningEffort)
    .filter((value) => effortOrder.includes(value))
    .sort(
      (a, b) =>
        Math.abs(effortOrder.indexOf(a) - index) -
          Math.abs(effortOrder.indexOf(b) - index) ||
        effortOrder.indexOf(a) - effortOrder.indexOf(b),
    );
  return index < 0 || !supported.length
    ? model.defaultReasoningEffort || options[0].reasoningEffort
    : supported[0];
}
