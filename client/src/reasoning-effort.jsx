import React, { useEffect, useId, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { selectEffort, useStore } from "./store";

export const reasoningEffortLabels = {
  none: "无",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
  ultra: "超高",
};

export function ReasoningEffortControl({ inline = false }) {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const trigger = useRef();
  const id = useId();
  const model = s.models.find((m) => m.model === s.model);
  const options = model?.supportedReasoningEfforts || [];
  const effort = s.effort || model?.defaultReasoningEffort || "";
  const index = Math.max(
    0,
    options.findIndex((option) => option.reasoningEffort === effort),
  );
  const label = reasoningEffortLabels[effort] || effort || "默认";
  useEffect(() => setOpen(false), [s.model, s.current?.id]);

  const slider = (
    <div
      className="reasoning-effort-slider"
      role="group"
      aria-label="思考强度设置"
    >
      <div className="reasoning-effort-heading">
        <span>思考强度</span>
        <output htmlFor={id}>{label}</output>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={Math.max(0, options.length - 1)}
        step={1}
        value={index}
        aria-label="思考强度"
        aria-valuetext={label}
        disabled={options.length < 2}
        autoFocus={open && !inline}
        style={{
          "--effort-progress": `${options.length > 1 ? (index / (options.length - 1)) * 100 : 0}%`,
        }}
        onChange={(e) =>
          selectEffort(options[Number(e.target.value)].reasoningEffort)
        }
      />
      <div className="reasoning-effort-labels" aria-hidden="true">
        {options.map((option) => (
          <span
            key={option.reasoningEffort}
            data-selected={option.reasoningEffort === effort}
            title={option.description}
          >
            {reasoningEffortLabels[option.reasoningEffort] ||
              option.reasoningEffort}
          </span>
        ))}
      </div>
      <p className="reasoning-effort-hint">
        {options.length > 1
          ? "拖动滑块调整下一轮任务的思考强度。"
          : options.length === 1
            ? "当前模型仅提供这一档思考强度。"
            : "当前模型使用默认思考强度。"}
      </p>
    </div>
  );
  if (inline) return slider;
  return (
    <div
      className="reasoning-effort"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (open && e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        type="button"
        ref={trigger}
        className="reasoning-effort-trigger"
        aria-label="调整思考强度"
        aria-expanded={open}
        aria-controls={open ? `${id}-popover` : undefined}
        title={`思考强度：${label}`}
        disabled={options.length < 2}
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal size={15} />
        <span>{label}</span>
      </button>
      {open && (
        <div id={`${id}-popover`} className="reasoning-effort-popover">
          {slider}
        </div>
      )}
    </div>
  );
}
