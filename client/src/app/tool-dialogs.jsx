import React, { useState, useEffect } from "react";

import { Search, Plus, Sparkles } from "lucide-react";
import {
  useStore,
  set,
  setDraft,
  get,
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
              key={skill.path || skill.name}
              onClick={() => {
                if (skill.native) {
                  setDraft(`/${skill.name} ${get().draft}`);
                  set({ modal: null });
                  return;
                }
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
export { PluginsDialog } from "./plugins-dialog.jsx";
