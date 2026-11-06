import React, { useEffect, useState } from "react";
import { ProviderModelNames } from "./provider-model-names.jsx";
import { PresetProviderForm } from "./preset-provider-form.jsx";
import { rpc, saveProvider } from "../store.js";
export function ProviderSettings({ backend }) {
  const [providers, setProviders] = useState([]),
    [editing, setEditing] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    rpc("lan/providers/list", { backendId: backend.id, includeDisabled: true })
      .then((r) => {
        if (current) setProviders(r.providers);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [backend.id]);
  return (
    <div className="provider-settings">
      {providers.map((p) => (
        <div className="backend-heading" key={p.id}>
          <span className="provider-identity">
            {p.preset && (
              <>
                <img
                  className="provider-brand-symbol"
                  src={
                    new URL(
                      `../assets/providers/${p.icon}.svg`,
                      import.meta.url,
                    ).href
                  }
                  alt={`${p.name} 标识`}
                />
              </>
            )}
            <span>{p.name}</span>
          </span>
          {p.preset && <span>{p.hasApiKey ? "已启用" : "待填写 API Key"}</span>}
          <button onClick={() => setEditing(p)}>编辑</button>
        </div>
      ))}
      <button onClick={() => setEditing({ name: "", baseUrl: "", models: [] })}>
        添加供应商
      </button>
      {editing?.preset && (
        <PresetProviderForm
          key={editing.id}
          provider={editing}
          backendId={backend.id}
          onSaved={(providers) => {
            setProviders(providers);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {editing && !editing.preset && (
        <form
          className="backend-form"
          key={editing.id || "new"}
          onSubmit={async (event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            setBusy(true);
            setError("");
            try {
              const key = values.get("apiKey");
              await saveProvider({
                id: editing.id,
                backendId: backend.id,
                name: values.get("name"),
                baseUrl: values.get("baseUrl"),
                protocol: values.get("protocol"),
                modelAliases: Object.fromEntries(
                  editing.models
                    .map((model) => model.trim())
                    .filter(Boolean)
                    .map((model) => [
                      model,
                      values.get("alias-" + model) || "",
                    ]),
                ),
                modelCapabilities: Object.fromEntries(
                  editing.models
                    .map((model) => model.trim())
                    .filter(Boolean)
                    .map((model) => [
                      model,
                      {
                        ...(values.get("context-" + model) && {
                          contextWindow: Number(values.get("context-" + model)),
                        }),
                        supportedEffortLevels: values.getAll("effort-" + model),
                        supportsFastMode: values.has("fast-" + model),
                        supportsAdaptiveThinking: values.has(
                          "adaptive-" + model,
                        ),
                      },
                    ]),
                ),
                models: values
                  .get("models")
                  .split(/\r?\n/)
                  .map((v) => v.trim())
                  .filter(Boolean),
                ...(values.has("clearKey")
                  ? { apiKey: "" }
                  : key
                    ? { apiKey: key }
                    : {}),
              });
              setProviders(
                (
                  await rpc("lan/providers/list", {
                    backendId: backend.id,
                    includeDisabled: true,
                  })
                ).providers,
              );
              setEditing(null);
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            名称
            <input name="name" required defaultValue={editing.name} />
          </label>
          <label>
            API 协议
            <select
              name="protocol"
              defaultValue={editing.protocol || "messages"}
            >
              <option value="messages">标准 Messages API</option>
              <option value="anthropic">Anthropic 原生 API</option>
            </select>
          </label>
          <label>
            API 地址
            <input
              name="baseUrl"
              type="url"
              required
              defaultValue={editing.baseUrl}
            />
          </label>
          <label>
            API Key
            <input
              name="apiKey"
              type="password"
              autoComplete="new-password"
              placeholder={editing.hasApiKey ? "已配置；留空保留" : "可留空"}
            />
          </label>
          {editing.hasApiKey && (
            <label className="backend-checkbox">
              <input name="clearKey" type="checkbox" />
              清除已保存凭据
            </label>
          )}
          <label>
            模型标识（每行一个）
            <textarea
              name="models"
              required
              value={editing.models.join("\n")}
              onChange={(event) =>
                setEditing({
                  ...editing,
                  models: event.target.value.split(/\r?\n/),
                })
              }
              rows={3}
            />
          </label>
          <ProviderModelNames
            models={editing.models}
            aliases={editing.modelAliases}
          />
          <details>
            <summary>模型参数</summary>
            {editing.models
              .map((model) => model.trim())
              .filter(Boolean)
              .map((model) => (
                <fieldset key={model}>
                  <legend>{model}</legend>
                  <label>
                    上下文容量（tokens）
                    <input
                      name={"context-" + model}
                      type="number"
                      min="1"
                      step="1"
                      placeholder="服务实际加载的容量"
                      defaultValue={
                        editing.modelCapabilities?.[model]?.contextWindow || ""
                      }
                    />
                  </label>
                  <span>思考强度</span>
                  {["low", "medium", "high", "xhigh", "max"].map((level) => (
                    <label className="backend-checkbox" key={level}>
                      <input
                        type="checkbox"
                        name={"effort-" + model}
                        value={level}
                        defaultChecked={editing.modelCapabilities?.[
                          model
                        ]?.supportedEffortLevels?.includes(level)}
                      />
                      {level}
                    </label>
                  ))}
                  <label className="backend-checkbox">
                    <input
                      type="checkbox"
                      name={"fast-" + model}
                      defaultChecked={
                        editing.modelCapabilities?.[model]?.supportsFastMode
                      }
                    />
                    支持快速模式
                  </label>
                  <label className="backend-checkbox">
                    <input
                      type="checkbox"
                      name={"adaptive-" + model}
                      defaultChecked={
                        editing.modelCapabilities?.[model]
                          ?.supportsAdaptiveThinking
                      }
                    />
                    支持自适应思考
                  </label>
                </fieldset>
              ))}
          </details>
          <div>
            <button type="submit" disabled={busy}>
              保存供应商
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
