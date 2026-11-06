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
  const choices = (s.modelChoices || []).filter(
    (choice) => !s.current || choice.backendId === s.backendId,
  );
  const current = choices.find(
    (choice) =>
      choice.backendId === s.backendId &&
      choice.providerId === s.providerId &&
      choice.model === s.model,
  );
  const locked = s.busy || s.loading || Boolean(s.active[s.current?.id]);
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
        {choices.length ? (
          <>
            {!current && s.model && <option value={s.model}>{s.model}</option>}
            {choices.map((choice) => (
              <option key={key(choice)} value={key(choice)}>
                {choice.providerName} · {choice.displayName || choice.model}
              </option>
            ))}
          </>
        ) : (
          s.models.map((model) => (
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
