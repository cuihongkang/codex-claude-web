import React from "react";
import { Pencil } from "lucide-react";

export function ProviderModelNames({ models, aliases = {} }) {
  return (
    <div className="provider-model-names">
      <span className="provider-model-heading">模型显示名称</span>
      {[...new Set(models.map((model) => model.trim()).filter(Boolean))].map(
        (model) => (
          <details className="provider-model-name" key={model}>
            <summary title={model}>
              <span>{aliases[model] || model}</span>
              <Pencil size={14} />
            </summary>
            <div className="provider-model-name-fields">
              <label>
                显示别名
                <input
                  name={"alias-" + model}
                  defaultValue={aliases[model] || ""}
                  placeholder="留空使用原名称"
                />
              </label>
              <p>
                模型 ID<span>{model}</span>
              </p>
            </div>
          </details>
        ),
      )}
    </div>
  );
}
