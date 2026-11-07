import React, { useEffect, useState } from "react";
import { useStore, rpc, set } from "../store.js";

export function CodexModelSettings({ backend }) {
  const s = useStore();
  const [models, setModels] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    rpc("model/list", { backendId: "codex", cwd: s.cwd }).then(
      (result) => {
        if (active) {
          setModels(result.data);
          setError("");
        }
      },
      (error) => {
        if (active) setError(error.message);
      },
    );
    return () => {
      active = false;
    };
  }, [backend.ready, s.cwd]);
  async function toggle(id, shown) {
    setBusy(true);
    setError("");
    try {
      const hidden = new Set(backend.hiddenModels || []);
      if (shown) hidden.delete(id);
      else hidden.add(id);
      const result = await rpc("lan/backends/save", {
        id: "codex",
        type: "codex",
        hiddenModels: [...hidden],
      });
      set({ backends: result.backends });
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="codex-model-settings">
      <summary>显示的模型</summary>
      <div className="codex-model-options">
        {models.map((model) => (
          <label key={model.model}>
            <input
              type="checkbox"
              disabled={busy}
              checked={!backend.hiddenModels?.includes(model.model)}
              onChange={(event) => toggle(model.model, event.target.checked)}
            />
            {model.displayName || model.model}
          </label>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
