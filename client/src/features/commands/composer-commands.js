import { newDraftKey } from "../../infrastructure/backend-storage.js";
import * as store from "../../store.js";
import { isCompacting } from "../../domain/compaction.js";
import { readAnnotationDrafts } from "../annotations/annotation-drafts.js";

// 通用命令维护产品状态，原生命令来自当前执行目录的实际目录。
export const composerCommands = [
  {
    id: "init",
    label: "初始化项目指令",
    description: "检查项目并生成 AGENTS.md，保留已有文件",
    idle: true,
  },
  { id: "new", label: "新对话", description: "在当前项目开始新对话" },
  { id: "model", label: "模型与思考强度", description: "选择模型和推理强度" },
  { id: "plan", label: "计划模式", description: "切换计划模式与执行模式" },
  { id: "review", label: "代码审查", description: "审查当前项目未提交的更改" },
  {
    id: "compact",
    label: "整理上下文",
    description: "压缩当前对话上下文",
    current: true,
    idle: true,
  },
  {
    id: "goal",
    label: "任务目标",
    description: "查看、设置、编辑、暂停、恢复或清除目标",
    args: "[目标 | edit | pause | resume | clear]",
  },
  { id: "skills", label: "技能", description: "选择已安装技能" },
  { id: "files", label: "文件", description: "浏览和编辑项目文件" },
  { id: "diff", label: "查看变更", description: "查看 Git 差异及对话变更" },
  { id: "terminal", label: "终端", description: "打开本机交互式终端" },
  {
    id: "stop",
    label: "清理后台终端",
    description: "停止当前对话启动的全部后台终端",
    current: true,
  },
  { id: "project", label: "切换项目", description: "选择本机工作目录" },
  { id: "search", label: "搜索对话", description: "查找已有聊天记录" },
  { id: "status", label: "设置", description: "查看外观、快捷键和版本信息" },
  {
    id: "fork",
    label: "创建分支",
    description: "从当前对话继续另一条思路",
    current: true,
  },
  {
    id: "rename",
    label: "重命名对话",
    description: "修改当前对话的名称",
    current: true,
  },
  {
    id: "delete",
    label: "删除对话",
    description: "删除当前对话记录",
    current: true,
  },
];

export function nativeComposerCommands(state) {
  const managed = new Set([
    ...composerCommands.map((command) => command.id),
    "clear",
    "effort",
    "fast",
  ]);
  return (state.nativeCommands || [])
    .filter((command) => !managed.has(command.name))
    .map((command) => ({
      id: command.name,
      label: command.name,
      description: command.description || "",
      args: command.argumentHint || "[参数]",
      idle: true,
      native: true,
    }));
}

export function parseComposerCommand(text, native = []) {
  const match = /^\s*\/([\w:-]+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) return null;
  const name = match[1].toLowerCase();
  return {
    name,
    args: match[2]?.trim() || "",
    command:
      composerCommands.find((c) => c.id === name) ||
      native.find((c) => c.id === name),
  };
}

export function commandAvailable(command, state) {
  return (
    (!command.current || !!state.current) &&
    (!command.active || !!state.active[state.current?.id])
  );
}

export function absolutePath(path, cwd) {
  const parts = (path.startsWith("/") ? path : cwd + "/" + path).split("/");
  const result = [];
  for (const part of parts) {
    if (part === "..") result.pop();
    else if (part && part !== ".") result.push(part);
  }
  return "/" + result.join("/");
}

export async function commandPages(method, params, isCurrent = () => true) {
  const rows = [];
  let cursor;
  do {
    const page = await store.rpc(method, {
      ...params,
      ...(cursor ? { cursor } : {}),
    });
    if (!isCurrent()) return [];
    rows.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor);
  return rows;
}

const initPrompt = `请为当前工作目录中的项目生成 AGENTS.md，作为今后参与此项目的代理和贡献者的指南。
写入前检查当前目录是否已有 AGENTS.md；已有时保留其全部内容并告知位置。
阅读实际源码结构、配置、构建脚本、测试和近期 Git 提交约定，再编写简洁、独立可读的 Markdown 文档。
按项目实际情况涵盖：项目结构与入口、构建及开发命令、代码风格、测试与验证要求、提交和合并请求约定，以及必要的配置注意事项。
提供可执行的命令和准确的目录示例，省略不适用的章节，遵循项目现有语言与规范。`;

let dispatching = false;
export async function runComposerCommand(text) {
  if (dispatching) throw new Error("上一条命令仍在执行，请稍候重试。");
  if (!parseComposerCommand(text)) return false;
  dispatching = true;
  try {
    return await executeCommand(text);
  } finally {
    dispatching = false;
  }
}

async function executeCommand(text) {
  const parsed = parseComposerCommand(
    text,
    nativeComposerCommands(store.get()),
  );
  if (!parsed) return false;
  const { command, name, args } = parsed;
  if (!command) throw new Error(`未识别的命令 /${name}。输入 / 查看可用命令。`);
  let s = store.get();
  if (command.id === "goal" && !s.current) {
    if (s.busy || s.loading)
      throw new Error("请等待当前操作结束后使用此命令。");
    await store.ensureThread();
    s = store.get();
  }
  if (!commandAvailable(command, s))
    throw new Error(
      `/${name} 需要${command.active ? "正在运行的任务" : "已打开的对话"}。`,
    );
  if (command.idle && (s.busy || s.active[s.current?.id]))
    throw new Error(`请等待当前任务结束后使用 /${name}。`);
  if (args && !command.args)
    throw new Error(`/${name} 无需参数，请单独执行此命令。`);
  const dialog = (view, extra = {}) =>
    store.set({
      modal: { type: "command", view, thread: s.current, cwd: s.cwd, ...extra },
    });
  if (command.native) {
    if (!(await store.sendMessage(text, s.attachments, { clearDraft: true })))
      return true;
    return true;
  }
  switch (command.id) {
    case "init": {
      const thread = await store.ensureThread();
      const { entries } = await store.rpc("fs/readDirectory", {
        path: thread.cwd,
      });
      if (store.get().current?.id !== thread.id)
        throw new Error("对话已切换，请在当前对话重试 /init。");
      if (entries.some((e) => e.fileName === "AGENTS.md")) {
        store.set({
          panel: "files",
          panelFile: absolutePath("AGENTS.md", thread.cwd),
        });
        store.notice("当前目录已有 AGENTS.md，已保留并打开。");
      } else if (
        !(await store.sendMessage(initPrompt, [], { clearDraft: false }))
      )
        return true;
      break;
    }
    case "new":
      if (s.draft === text) store.setDraft("");
      store.newChat();
      return true;
    case "model":
      store.set({ modal: { type: "model" } });
      break;
    case "plan": {
      const mode = s.mode === "plan" ? "default" : "plan";
      store.set({ mode });
      store.notice(mode === "plan" ? "已切换到计划模式" : "已切换到执行模式");
      break;
    }
    case "review":
      store.set({ panel: "changes" });
      await store.review();
      break;
    case "compact":
      if ((await store.compact()) === false) return true;
      break;
    case "goal": {
      if (!args || args === "edit") {
        dialog("goal", { edit: args === "edit" });
        break;
      }
      const params = { threadId: s.current.id, origin: "user" };
      if (args === "clear") await store.rpc("thread/goal/clear", params);
      else if (["pause", "resume"].includes(args))
        await store.rpc("thread/goal/set", {
          ...params,
          status: args === "pause" ? "paused" : "active",
        });
      else {
        if (args.length > 4000) throw new Error("任务目标最多 4000 个字符。");
        await store.rpc("thread/goal/set", {
          ...params,
          objective: args,
          status: "active",
        });
      }
      if (store.get().current?.id === s.current.id) dialog("goal");
      break;
    }
    case "skills":
      store.set({ modal: { type: "skills" } });
      break;
    case "files":
      store.set({ panel: "files" });
      break;
    case "diff":
      store.set({ panel: "changes" });
      break;
    case "terminal":
      store.set({ terminalOpen: true });
      break;
    case "stop":
      dialog("stop");
      break;
    case "project":
      store.set({ modal: { type: "directory" } });
      break;
    case "search":
      store.set({ modal: { type: "search" } });
      break;
    case "status":
      store.set({ modal: { type: "settings" } });
      break;
    case "fork":
      await store.fork();
      break;
    case "rename":
    case "delete":
      store.set({ modal: { type: command.id, thread: s.current } });
      break;
  }
  if (store.get().current?.id === s.current?.id && store.get().draft === text)
    store.setDraft("");
  // /init 首次创建对话后，草稿已迁移到实际 ID。
  else if (command.id === "init" && store.get().draft === text)
    store.setDraft("");
  const draftKey = s.current
    ? "cx-draft-" + s.current.id
    : newDraftKey(s.backendId);
  if (
    store.get().current?.id !== s.current?.id &&
    localStorage.getItem(draftKey) === text
  )
    localStorage.removeItem(draftKey);
  return true;
}

export async function submitComposer() {
  if (isCompacting(store.get().compactions[store.get().current?.id])) return;
  try {
    const s = store.get();
    const annotations = readAnnotationDrafts(s.current?.id);
    if (!annotations.length && (await runComposerCommand(s.draft))) return;
    await store.sendMessage(s.draft, s.attachments, { annotations });
  } catch (error) {
    store.report(error);
  }
}
