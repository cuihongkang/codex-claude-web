import React from "react";
import { Zap } from "lucide-react";
import { set, useStore } from "../../store.js";
import {
  modelServiceTiers,
  resolveServiceTier,
} from "../../domain/service-tier.js";

export function ServiceTierToggle() {
  const s = useStore();
  const model = s.models.find((m) => m.model === s.model);
  const tier = resolveServiceTier(s.serviceTier, model);
  const tiers = modelServiceTiers(model);
  const fast = tiers.find((option) => ["fast", "priority"].includes(option.id));
  const name =
    tiers.find((option) => option.id === tier)?.name ||
    { fast: "Fast", priority: "Fast", ultrafast: "Ultra Fast" }[tier] ||
    tier;
  const hint = tier
    ? `当前速度：${name}；点击切换为标准`
    : fast
      ? "当前速度：标准；点击开启 Fast（增加用量）"
      : "当前模型使用标准速度";
  return (
    <button
      type="button"
      className="icon-button service-tier-toggle"
      aria-label="速度模式"
      aria-pressed={Boolean(tier)}
      title={`${hint}。设置应用于下一轮任务。`}
      disabled={!tier && !fast}
      onClick={() => set({ serviceTier: tier ? null : fast.id })}
    >
      <Zap size={17} fill={tier ? "currentColor" : "none"} />
    </button>
  );
}
