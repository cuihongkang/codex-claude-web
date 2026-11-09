import { page } from "./history.mjs";
import {
  captureNativeProcesses,
  nativeProcessesAlive,
  recoverNativeProcesses,
} from "./process-ownership.mjs";

export function createBackgroundTasks({ storage, save, emit }) {
  const owners = new Map();
  async function event(threadId, message, process) {
    if (message.type !== "system") return;
    const subtype = message.subtype;
    if (
      ["task_started", "background_tasks_changed"].includes(subtype) &&
      process.child?.pid
    ) {
      const { owner, children } = await captureNativeProcesses(
        process.child.pid,
      );
      await save(threadId, (s) => ({
        ...s,
        nativeProcess: owner,
        nativeChildren: children,
      }));
    }
    if (subtype === "background_tasks_changed") {
      const tasks = Object.fromEntries(
        message.tasks.map((task) => {
          owners.set(`${threadId}/${task.task_id}`, process);
          return [
            task.task_id,
            { ...task, status: "running", is_backgrounded: true },
          ];
        }),
      );
      await save(threadId, (s) => ({ ...s, backgroundTasks: tasks }));
    } else if (
      [
        "task_started",
        "task_progress",
        "task_updated",
        "task_notification",
      ].includes(subtype)
    ) {
      const id = message.task_id;
      owners.set(`${threadId}/${id}`, process);
      if (subtype === "task_started" && message.task_type === "local_agent") {
        const agentId = `agent/${threadId}/${id}`;
        let details;
        await save(threadId, (s) => {
          const call = s.agentCalls?.[message.tool_use_id];
          details = {
            ...s.agents?.[agentId],
            ...call,
            agentId: id,
            name: call?.name || message.description || message.subagent_type,
            initialTask: message.prompt || call?.initialTask,
            toolUseId: message.tool_use_id,
            parentNativeId: message.session_id,
          };
          return { ...s, agents: { ...s.agents, [agentId]: details } };
        });
        const turnId = process.lastTurnId;
        const item = {
          id: `agent-${id}`,
          turnId,
          type: "subAgentActivity",
          kind: "started",
          agentThreadId: agentId,
          agentPath: details.name,
          prompt: details.initialTask,
        };
        await save(threadId, (s) => ({
          ...s,
          extraItems: { ...s.extraItems, [item.id]: item },
        }));
        emit("item/completed", { threadId, turnId, item });
      }
      await save(threadId, (s) => ({
        ...s,
        backgroundTasks: {
          ...s.backgroundTasks,
          [id]: {
            ...s.backgroundTasks?.[id],
            ...message,
            ...message.patch,
            ...(subtype === "task_started" && { status: "running" }),
          },
        },
      }));
    } else return;
    emit("thread/backgroundTerminals/updated", { threadId });
  }
  async function records(p) {
    const session = (await storage.read()).sessions[p.threadId];
    if (!session) throw new Error("对话不存在");
    const ended = new Set();
    for (const task of Object.values(session.backgroundTasks || {})) {
      if (task.status !== "unknown" || !task.nativeProcess) continue;
      if (await nativeProcessesAlive(task)) continue;
      ended.add(task.task_id);
      await save(p.threadId, (s) => ({
        ...s,
        backgroundTasks: {
          ...s.backgroundTasks,
          [task.task_id]: {
            ...s.backgroundTasks[task.task_id],
            status: "stopped",
          },
        },
      }));
    }
    const tasks = Object.values(session.backgroundTasks || {})
      .filter(
        (task) =>
          !ended.has(task.task_id) &&
          task.is_backgrounded &&
          ["local_bash", "shell", "local_shell"].includes(task.task_type) &&
          ["running", "pending", "unknown"].includes(task.status),
      )
      .map((task) => ({
        processId: task.task_id,
        command: task.description || task.summary || "后台终端",
        cwd: session.cwd,
        status: task.status,
      }));
    return tasks;
  }
  async function clean(p) {
    const data = await records(p);
    const results = await Promise.allSettled(
      data.map(async (task) => {
        const process = owners.get(`${p.threadId}/${task.processId}`);
        if (!process?.query) {
          const session = (await storage.read()).sessions[p.threadId];
          const previous = session.backgroundTasks[task.processId];
          if (!previous.nativeProcess)
            throw new Error("后台终端缺少可核对的进程身份，请检查原后端进程。");
          await recoverNativeProcesses(previous);
        } else await process.query.stopTask(task.processId);
        await save(p.threadId, (s) => ({
          ...s,
          backgroundTasks: {
            ...s.backgroundTasks,
            [task.processId]: {
              ...s.backgroundTasks[task.processId],
              status: "stopped",
            },
          },
        }));
      }),
    );
    const errors = results.filter((r) => r.status === "rejected");
    if (errors.length)
      throw new Error(errors.map((r) => r.reason.message).join("\n"));
    return { stopped: data.length };
  }
  return {
    event,
    handlers: new Map([
      [
        "thread/backgroundTerminals/list",
        async (p) => page(await records(p), p),
      ],
      ["thread/backgroundTerminals/clean", clean],
    ]),
  };
}
