import React from "react";
import { ChevronDown } from "lucide-react";
import {
  useStore,
  selectModel,
  refreshThreadAccess,
  report,
} from "../../store.js";
import { isCompacting } from "../../domain/compaction.js";

export function ProviderSelect() {
  const s = useStore();
  const known = s.providers.some((p) => p.id === s.providerId);
  if (
    !s.providersSupported ||
    !s.providers.length ||
    (s.providers.length < 2 && known)
  )
    return null;
  const disabled =
    s.busy ||
    s.loading ||
    Boolean(s.active[s.current?.id]) ||
    isCompacting(s.compactions[s.current?.id]);
  return (
    <label className="select-control provider-select">
      <select
        aria-label="供应商"
        value={s.providerId}
        disabled={disabled}
        onChange={(event) => {
          const model = s.models.find(
            (m) => m.providerId === event.target.value,
          );
          if (model) {
            selectModel(model);
            if (s.threadAccess && s.threadAccess.status !== "ready")
              refreshThreadAccess().catch(report);
          }
        }}
      >
        {!known && (
          <option value={s.providerId} disabled>
            请选择供应商
          </option>
        )}
        {s.providers.map((provider) => (
          <option key={provider.id} value={provider.id}>
            {provider.name}
          </option>
        ))}
      </select>
      <ChevronDown size={12} />
    </label>
  );
}
