import React from "react";
import { ChevronDown } from "lucide-react";
import {
  useStore,
  selectModel,
  selectModelChoice,
  report,
} from "../../store.js";

const key = (choice) =>
  JSON.stringify([choice.backendId, choice.providerId, choice.model]);
export function ModelSelect() {
  const s = useStore();
  const hidden = s.backends.find((b) => b.id === "codex")?.hiddenModels || [];
  const visible = (model, backendId) =>
    backendId !== "codex" || !hidden.includes(model.model);
  const choices = (s.modelChoices || []).filter(
    (choice) =>
      (!s.current || choice.backendId === s.backendId) &&
      visible(choice, choice.backendId),
  );
  const current = choices.find(
    (choice) =>
      choice.backendId === s.backendId &&
      choice.providerId === s.providerId &&
      choice.model === s.model,
  );
  const locked = s.busy || s.loading;
  return (
    <label className="select-control model-select">
      <select
        aria-label="模型"
        value={current ? key(current) : s.model}
        disabled={locked}
        onChange={(event) => {
          const choice = choices.find(
            (choice) => key(choice) === event.target.value,
          );
          if (choice) selectModelChoice(choice).catch(report);
          else {
            const model = s.models.find(
              (model) => model.model === event.target.value,
            );
            if (model) selectModel(model);
          }
        }}
      >
        {choices.length ||
        (s.backendId === "codex" && hidden.includes(s.model)) ? (
          <>
            {!current && (
              <option value={s.model} disabled>
                {s.model
                  ? hidden.includes(s.model) && s.backendId === "codex"
                    ? `当前模型已隐藏：${s.model}`
                    : `当前模型不可用：${s.model}`
                  : "请选择模型"}
              </option>
            )}
            {choices.map((choice) => (
              <option
                key={key(choice)}
                value={key(choice)}
                disabled={
                  Boolean(s.active[s.current?.id]) &&
                  choice.providerId !== s.providerId
                }
              >
                {choice.providerName} · {choice.displayName || choice.model}
              </option>
            ))}
          </>
        ) : (
          s.models
            .filter((model) => visible(model, s.backendId))
            .map((model) => (
              <option key={model.id} value={model.model}>
                {model.displayName || model.model}
              </option>
            ))
        )}
      </select>
      <ChevronDown size={12} />
    </label>
  );
}
