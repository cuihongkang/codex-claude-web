import React, { useState } from "react";
import { rpc, saveProvider } from "../store.js";

export function PresetProviderForm({ provider, backendId, onSaved, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="backend-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        setBusy(true);
        setError("");
        try {
          await saveProvider({
            id: provider.id,
            backendId,
            apiKey: String(values.get("apiKey") || "").trim(),
          });
          const result = await rpc("lan/providers/list", {
            backendId,
            includeDisabled: true,
          });
          onSaved(result.providers);
        } catch (error) {
          setError(error.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        API Key
        <input
          name="apiKey"
          type="password"
          autoComplete="new-password"
          placeholder="填写后启用；保存空值清除凭据并停用"
        />
      </label>
      <div>
        <button type="submit" disabled={busy}>
          保存供应商
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          取消
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
