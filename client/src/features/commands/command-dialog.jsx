import React, { useEffect, useRef, useState } from "react";
import { RefreshCw, LoaderCircle } from "lucide-react";
import * as store from "../../store.js";
import { commandPages } from "./composer-commands.js";

export const commandTitles = { goal: "任务目标", stop: "清理后台终端" };

function useResource(load, key) {
  const { connected } = store.useStore();
  const [attempt, retry] = useState(0);
  const [state, update] = useState({ loading: true });
  useEffect(() => {
    let cancelled = false;
    update({ loading: true });
    Promise.resolve()
      .then(() => load(() => !cancelled))
      .then(
        (data) => {
          if (!cancelled) update({ data, loading: false });
        },
        (error) => {
          if (!cancelled) update({ error: error.message, loading: false });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [key, attempt, connected]);
  return { ...state, reload: () => retry((n) => n + 1) };
}

function ResourceState({ resource }) {
  if (resource.loading)
    return (
      <p className="loading">
        <LoaderCircle size={16} className="spin" />
        正在读取…
      </p>
    );
  if (resource.error)
    return (
      <div className="inline-error" role="alert">
        {resource.error}
        <button className="secondary" onClick={resource.reload}>
          重试
        </button>
      </div>
    );
  return null;
}

function useAction() {
  const [state, update] = useState({ busy: false, error: "" });
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  return {
    ...state,
    run: async (fn) => {
      if (state.busy) return;
      update({ busy: true, error: "" });
      try {
        await fn();
        if (live.current) update({ busy: false, error: "" });
      } catch (error) {
        if (live.current) update({ busy: false, error: error.message });
      }
    },
  };
}

function ActionError({ action }) {
  return (
    action.error && (
      <p className="inline-error" role="alert">
        {action.error}
      </p>
    )
  );
}

const goalStates = {
  active: "进行中",
  paused: "已暂停",
  blocked: "等待解决阻塞",
  usageLimited: "用量已达上限",
  budgetLimited: "预算已达上限",
  complete: "已完成",
};
function GoalDialog({ modal }) {
  const resource = useResource(
    () => store.rpc("thread/goal/get", { threadId: modal.thread.id }),
    modal.thread.id,
  );
  const action = useAction();
  const [objective, edit] = useState("");
  const [budget, setBudget] = useState("");
  useEffect(() => {
    if (resource.data) {
      edit(resource.data.goal?.objective || "");
      setBudget(resource.data.goal?.tokenBudget ?? "");
    }
  }, [resource.data]);
  const goal = resource.data?.goal;
  const mutate = (method, params) =>
    action.run(async () => {
      await store.rpc(method, {
        threadId: modal.thread.id,
        origin: "user",
        ...params,
      });
      resource.reload();
    });
  return (
    <>
      <ResourceState resource={resource} />
      {resource.data && (
        <>
          <p className="section-description">
            目标由 Codex 持续跟进，直到完成、暂停、达到预算或遇到阻塞。
          </p>
          <p role="status">
            {goal
              ? `${goalStates[goal.status] || "状态待更新"} · 已用 ${goal.tokensUsed.toLocaleString()} tokens · ${Math.round(goal.timeUsedSeconds)} 秒`
              : "当前对话尚未设置目标"}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const tokenBudget = budget === "" ? null : Number(budget);
              if (
                tokenBudget !== null &&
                (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0)
              )
                return;
              mutate("thread/goal/set", {
                objective: objective.trim(),
                status: "active",
                tokenBudget,
              });
            }}
          >
            <label className="field-label">
              目标
              <textarea
                autoFocus
                maxLength={4000}
                rows={4}
                value={objective}
                onChange={(e) => edit(e.target.value)}
              />
            </label>
            <label className="field-label">
              Token 预算（留空表示不限）
              <input
                type="number"
                min="1"
                step="1"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </label>
            <ActionError action={action} />
            <div className="modal-actions">
              {goal && (
                <button
                  type="button"
                  className="secondary"
                  disabled={action.busy}
                  onClick={() => mutate("thread/goal/clear", {})}
                >
                  清除目标
                </button>
              )}
              {goal && (
                <button
                  type="button"
                  className="secondary"
                  disabled={action.busy}
                  onClick={() =>
                    mutate("thread/goal/set", {
                      status: goal.status === "active" ? "paused" : "active",
                    })
                  }
                >
                  {goal.status === "active" ? "暂停目标" : "恢复目标"}
                </button>
              )}
              <button
                className="primary"
                disabled={action.busy || !objective.trim()}
              >
                {action.busy ? "正在保存…" : "保存并开始"}
              </button>
            </div>
          </form>
        </>
      )}
    </>
  );
}

function TerminalsDialog({ modal }) {
  const resource = useResource(
    (current) =>
      commandPages(
        "thread/backgroundTerminals/list",
        { threadId: modal.thread.id, limit: 100 },
        current,
      ),
    modal.thread.id,
  );
  const action = useAction();
  return (
    <>
      <ResourceState resource={resource} />
      {resource.data && (
        <>
          {!resource.data.length && <p>当前对话没有后台终端。</p>}
          {resource.data.map((terminal) => (
            <div className="command-record" key={terminal.processId}>
              <strong>{terminal.command}</strong>
              <small>
                {terminal.cwd}
                {terminal.osPid != null && ` · PID ${terminal.osPid}`}
              </small>
            </div>
          ))}
          <ActionError action={action} />
          <div className="modal-actions">
            <button
              className="secondary"
              disabled={action.busy}
              onClick={resource.reload}
            >
              <RefreshCw size={14} />
              刷新
            </button>
            <button
              className="danger-button"
              disabled={action.busy || !resource.data.length}
              onClick={() =>
                action.run(async () => {
                  await store.rpc("thread/backgroundTerminals/clean", {
                    threadId: modal.thread.id,
                  });
                  resource.reload();
                })
              }
            >
              停止全部后台终端
            </button>
          </div>
        </>
      )}
    </>
  );
}

export function CommandDialog({ modal }) {
  switch (modal.view) {
    case "goal":
      return <GoalDialog modal={modal} />;
    case "stop":
      return <TerminalsDialog modal={modal} />;
  }
}
