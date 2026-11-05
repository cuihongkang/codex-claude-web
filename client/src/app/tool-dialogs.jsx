import React, { useState, useEffect } from "react";

import { Search, Plus, TerminalSquare, Sparkles, Blocks } from "lucide-react";
import {
  useStore,
  set,
  rpc,
  report,
  notice,
  addAttachment,
  uid,
  loadSkills,
} from "../store.js";
import { Empty } from "../ui/primitives.jsx";
export function SkillsDialog() {
  const s = useStore(),
    [q, query] = useState("");
  useEffect(() => {
    loadSkills().catch(report);
  }, [s.cwd]);
  return (
    <>
      <label className="panel-search">
        <Search size={15} />
        <input
          autoFocus
          value={q}
          placeholder="搜索已安装技能"
          onChange={(e) => query(e.target.value)}
        />
      </label>
      <div className="catalog-list">
        {s.skills
          .filter((x) =>
            (x.name + " " + x.description)
              .toLowerCase()
              .includes(q.toLowerCase()),
          )
          .map((skill) => (
            <button
              className="catalog-card"
              key={skill.path}
              onClick={() => {
                addAttachment({
                  id: uid(),
                  name: skill.name,
                  input: { type: "skill", name: skill.name, path: skill.path },
                });
                set({ modal: null });
                notice("技能已加入下一条消息");
              }}
            >
              <div className="catalog-icon">
                <Sparkles size={21} />
              </div>
              <div>
                <strong>{skill.name}</strong>
                <p>{skill.shortDescription || skill.description}</p>
              </div>
              <Plus size={16} />
            </button>
          ))}
        {!s.skills.length && (
          <Empty icon={Sparkles} title="此目录没有可用技能" />
        )}
      </div>
    </>
  );
}
export function PluginsDialog() {
  const [data, update] = useState(null),
    [error, err] = useState("");
  useEffect(() => {
    Promise.all([
      rpc("plugin/installed"),
      rpc("mcpServerStatus/list", { limit: 100 }),
    ])
      .then(([plugins, mcp]) => update({ plugins, mcp }))
      .catch((e) => err(e.message));
  }, []);
  return (
    <div className="catalog-list">
      {error && <div className="inline-error">{error}</div>}
      {!data && !error && <div className="loading">正在读取插件…</div>}
      {data && (
        <>
          {data.plugins.marketplaces
            ?.flatMap((m) => m.plugins || [])
            .map((p) => (
              <div className="catalog-card" key={p.id}>
                <div className="catalog-icon">
                  <Blocks size={20} />
                </div>
                <div>
                  <strong>{p.interface?.displayName || p.name}</strong>
                  {p.interface?.shortDescription && (
                    <p>{p.interface.shortDescription}</p>
                  )}
                </div>
                <span className="status-tag">
                  {p.enabled ? "已启用" : "已停用"}
                </span>
              </div>
            ))}
          <h3 className="section-label">工具连接</h3>
          {data.mcp.data?.map((server) => (
            <div className="catalog-card" key={server.name}>
              <div className="catalog-icon">
                <TerminalSquare size={20} />
              </div>
              <div>
                <strong>{server.name}</strong>
                <p>{Object.keys(server.tools || {}).length} 项工具</p>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
