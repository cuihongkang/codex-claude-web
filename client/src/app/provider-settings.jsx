import React, { useState } from "react";
import { useStore, saveProvider, removeProvider } from "../store.js";

const emptyModel = () => ({
  id: "",
  contextWindow: 32768,
  maxOutputTokens: 4096,
});
const emptyProvider = () => ({
  name: "",
  baseUrl: "",
  protocol: "chat",
  apiKey: "",
  models: [emptyModel()],
});

export function ProviderSettings() {
  const s = useStore();
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changeKey, setChangeKey] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!s.providersSupported) return null;
  const update = (patch) => setEditing({ ...editing, ...patch });
  function edit(provider) {
    setEditing(provider ? { ...provider, apiKey: "" } : emptyProvider());
    setChangeKey(false);
    setConfirmDelete(false);
    setError("");
  }
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { hasApiKey, builtin, ...provider } = editing;
      if (hasApiKey && !changeKey) delete provider.apiKey;
      await saveProvider(provider);
      setEditing(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="provider-settings" aria-label="供应商设置">
      <h3>供应商</h3>
      {s.providers.map((provider) => (
        <div className="provider-row" key={provider.id}>
          <span>
            <b>{provider.name}</b>
            <small>
              {provider.builtin
                ? "使用当前 Codex 配置"
                : `${provider.models.length} 个模型`}
            </small>
          </span>
          {!provider.builtin && (
            <button
              type="button"
              disabled={busy}
              onClick={() => edit(provider)}
            >
              编辑
            </button>
          )}
        </div>
      ))}
      {!editing && (
        <button type="button" className="secondary" onClick={() => edit(null)}>
          添加供应商
        </button>
      )}
      {editing && (
        <form className="provider-form" onSubmit={submit}>
          <label>
            名称
            <input
              required
              value={editing.name}
              disabled={busy}
              onChange={(e) => update({ name: e.target.value })}
            />
          </label>
          <label>
            API 地址
            <input
              required
              type="url"
              placeholder="https://api.example.com/v1"
              value={editing.baseUrl}
              disabled={busy}
              onChange={(e) => update({ baseUrl: e.target.value })}
            />
          </label>
          <label>
            接口类型
            <select
              value={editing.protocol}
              disabled={busy}
              onChange={(e) => update({ protocol: e.target.value })}
            >
              <option value="chat">Chat Completions</option>
              <option value="responses">Responses</option>
            </select>
          </label>
          <label>
            API Key
            <input
              type="password"
              autoComplete="new-password"
              value={editing.apiKey}
              disabled={busy}
              placeholder={
                editing.hasApiKey && !changeKey ? "已保存，留空保留" : "可留空"
              }
              onChange={(e) => {
                setChangeKey(true);
                update({ apiKey: e.target.value });
              }}
            />
          </label>
          {editing.hasApiKey && (
            <label className="provider-checkbox">
              <input
                type="checkbox"
                checked={changeKey}
                disabled={busy}
                onChange={(e) => setChangeKey(e.target.checked)}
              />
              替换已保存的 API Key
            </label>
          )}
          {editing.models.map((model, index) => (
            <fieldset key={index} disabled={busy}>
              <legend>模型 {index + 1}</legend>
              <label>
                模型标识
                <input
                  required
                  value={model.id}
                  onChange={(e) =>
                    update({
                      models: editing.models.map((m, i) =>
                        i === index ? { ...m, id: e.target.value } : m,
                      ),
                    })
                  }
                />
              </label>
              <div className="provider-limits">
                <label>
                  上下文窗口（token）
                  <input
                    required
                    type="number"
                    min="4096"
                    step="1"
                    value={model.contextWindow}
                    onChange={(e) =>
                      update({
                        models: editing.models.map((m, i) =>
                          i === index
                            ? { ...m, contextWindow: Number(e.target.value) }
                            : m,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  最大输出（token）
                  <input
                    required
                    type="number"
                    min="1"
                    max={model.contextWindow - 1}
                    step="1"
                    value={model.maxOutputTokens}
                    onChange={(e) =>
                      update({
                        models: editing.models.map((m, i) =>
                          i === index
                            ? { ...m, maxOutputTokens: Number(e.target.value) }
                            : m,
                        ),
                      })
                    }
                  />
                </label>
              </div>
              {editing.models.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    update({
                      models: editing.models.filter((_, i) => i !== index),
                    })
                  }
                >
                  移除此模型
                </button>
              )}
            </fieldset>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              update({ models: [...editing.models, emptyModel()] })
            }
          >
            添加模型
          </button>
          {error && (
            <p className="provider-error" role="alert">
              {error}
            </p>
          )}
          {confirmDelete && (
            <p className="section-description">
              聊天记录会保留，继续发送前需重新选择供应商。
            </p>
          )}
          <div className="provider-actions">
            {editing.id && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    if (!confirmDelete) {
                      setConfirmDelete(true);
                      return;
                    }
                    await removeProvider(editing.id);
                    setEditing(null);
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {confirmDelete ? "确认删除" : "删除供应商"}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              取消
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
