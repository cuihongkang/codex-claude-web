export function modelServiceTiers(model) {
  const tiers =
    model?.serviceTiers ??
    (model?.additionalSpeedTiers || []).map((id) => ({
      id: id === "fast" ? "priority" : id,
      name: id === "fast" ? "Fast" : id,
      description: "",
    }));
  return tiers.filter((tier) => tier.id && tier.id !== "default");
}

// Fast 和 priority 表示同一速度档位，发送时采用模型目录公布的 ID。
export function resolveServiceTier(tier, model) {
  if (!tier || tier === "default") return null;
  if (tier !== "fast" && tier !== "priority") return tier;
  const tiers = modelServiceTiers(model);
  return (
    tiers.find((option) => option.id === tier)?.id ||
    tiers.find((option) => ["fast", "priority"].includes(option.id))?.id ||
    tier
  );
}
