export function modelOptions(provider, model, input) {
  const standard = provider && (provider.protocol || "messages") === "messages";
  const capabilities = provider?.modelCapabilities?.[model] || {};
  const effort = input.effort || undefined;
  const fastMode = ["fast", "priority"].includes(input.serviceTier);
  if (
    standard &&
    effort &&
    !capabilities.supportedEffortLevels?.includes(effort)
  )
    throw new Error("所选模型尚未配置此思考强度，请检查模型参数。");
  if (standard && fastMode && !capabilities.supportsFastMode)
    throw new Error("所选模型尚未配置快速模式，请检查模型参数。");
  return {
    ...(effort && { effort }),
    settings: { fastMode },
  };
}
