import { testNativeCommands } from "./native-commands.mjs";
import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testCommands(app, requests, setResponse) {
  const original = app.get();
  const thread = { id: "commands-fixture", cwd: "/commands", name: "命令验证" };
  const attachment = {
    id: "kept-image",
    input: { type: "image", url: "data:image/png;base64,AQ==" },
  };
  let existing = true,
    fail = "",
    finishDirectory,
    view;
  let goal = {
    objective: "检查命令",
    status: "active",
    tokensUsed: 100,
    timeUsedSeconds: 3,
    tokenBudget: null,
  };
  let terminals = [
    {
      processId: "process-1",
      command: "npm run dev",
      cwd: thread.cwd,
      osPid: 123,
    },
    {
      processId: "process-2",
      command: "npm run watch",
      cwd: thread.cwd,
      osPid: 456,
    },
  ];
  const response = ({ method, params }) => {
    if (method === fail) return { error: { message: "模拟请求失败" } };
    if (method === "skills/list" || method === "thread/list")
      return { data: [] };
    if (method === "fs/readDirectory")
      return finishDirectory
        ? new Promise((resolve) => finishDirectory(resolve))
        : { entries: existing ? [{ fileName: "AGENTS.md" }] : [] };
    if (["thread/start", "thread/read", "thread/resume"].includes(method))
      return { thread };
    if (method === "turn/start")
      return { turn: { id: "command-turn", status: "completed" } };
    if (method === "thread/backgroundTerminals/list")
      return {
        data: terminals.slice(params.cursor ? 1 : 0, params.cursor ? 2 : 1),
        nextCursor: terminals.length && !params.cursor ? "page-2" : null,
      };
    if (method === "thread/backgroundTerminals/clean") {
      terminals = [];
      return {};
    }
    if (method === "thread/goal/get") return { goal };
    if (method === "thread/goal/set") {
      goal = { ...goal, ...params };
      return { goal };
    }
    if (method === "thread/goal/clear") {
      goal = null;
      return { cleared: true };
    }
    return {};
  };
  const command = async (text) => {
    app.setDraft(text);
    await app.runComposerCommand(text);
  };
  const open = async () => {
    await act(async () => {
      view = create(
        React.createElement(app.CommandDialog, { modal: app.get().modal }),
      );
    });
  };
  const close = async () => {
    await act(async () => view.unmount());
    view = null;
  };
  const button = (text) =>
    view.root
      .findAllByType("button")
      .find((node) => node.props.children === text);
  try {
    setResponse(response);
    app.set({
      ...original,
      connected: true,
      current: thread,
      cwd: thread.cwd,
      active: {},
      busy: false,
      loading: false,
      threadAccess: null,
      attachments: [attachment],
      items: [],
    });
    assert.deepEqual(
      app.composerCommands.map((c) => c.id).sort(),
      [
        "init",
        "new",
        "model",
        "plan",
        "review",
        "compact",
        "goal",
        "skills",
        "files",
        "diff",
        "terminal",
        "stop",
        "project",
        "search",
        "status",
        "fork",
        "rename",
        "delete",
      ].sort(),
    );
    assert(app.composerCommands.every((c) => !c.aliases));
    assert.equal(app.parseComposerCommand("普通问题"), null);
    assert.equal(
      app.parseComposerCommand("/goal 检查\n全部命令").args,
      "检查\n全部命令",
    );
    const removed = [
      "resume",
      "fast",
      "recap",
      "side",
      "copy",
      "export",
      "apps",
      "plugins",
      "mcp",
      "hooks",
      "memories",
      "experimental",
      "import",
      "worktree",
      "mention",
      "ps",
      "interrupt",
      "pwd",
      "cd",
      "usage",
      "debug-config",
      "archive",
      "theme",
      "feedback",
      "help",
      "warnings",
      "rollout",
      "logout",
      "clear",
      "btw",
      "clean",
      "cwd",
    ];
    const beforeRemoved = requests.length;
    for (const id of removed) {
      assert.equal(app.parseComposerCommand("/" + id).command, undefined);
      await assert.rejects(command("/" + id), /未识别的命令/);
      assert.equal(app.get().draft, "/" + id);
    }
    assert.equal(requests.length, beforeRemoved);
    assert.equal(app.get().modal, original.modal);
    app.setDraft("/resume");
    await act(async () => app.submitComposer());
    assert.match(app.get().error, /未识别的命令/);
    assert.equal(app.get().draft, "/resume");
    assert.equal(
      app.absolutePath("../other folder", "/commands/project"),
      "/commands/other folder",
    );

    const start = requests.length;
    await act(async () => command("/init"));
    assert.equal(app.get().panelFile, "/commands/AGENTS.md");
    assert.equal(
      requests
        .slice(start)
        .some((r) => ["turn/start", "fs/writeFile"].includes(r.method)),
      false,
    );
    assert.deepEqual(app.get().attachments, [attachment]);
    existing = false;
    await act(async () => command("/init"));
    const init = requests.findLast((r) => r.method === "turn/start");
    assert.match(init.params.input[0].text, /已有时保留其全部内容/);
    assert.equal(init.params.input.length, 1);
    assert.equal(app.get().draft, "");
    assert.deepEqual(app.get().attachments, [attachment]);
    fail = "turn/start";
    await act(async () => command("/init"));
    assert.equal(app.get().draft, "/init");
    assert.equal(app.get().error, "模拟请求失败");
    fail = "";
    app.set({ active: { [thread.id]: "running" } });
    await assert.rejects(command("/init"), /等待当前任务结束/);
    app.set({ active: {} });
    let resolveDirectory;
    finishDirectory = (resolve) => {
      resolveDirectory = resolve;
    };
    const pending = command("/init");
    await Promise.resolve();
    await Promise.resolve();
    app.set({
      current: { id: "switched", cwd: "/elsewhere" },
      draft: "新草稿",
    });
    resolveDirectory({ entries: [] });
    await assert.rejects(pending, /对话已切换/);
    assert.equal(app.get().draft, "新草稿");
    finishDirectory = undefined;
    app.set({ current: thread, cwd: thread.cwd, mode: "default" });

    for (const text of [
      "/new 名称",
      "/plan 任务",
      "/review 自定义要求",
      "/rename 名称",
    ]) {
      await assert.rejects(command(text), /无需参数/);
      assert.equal(app.get().draft, text);
    }
    await act(async () => command("/plan"));
    assert.equal(app.get().mode, "plan");
    await act(async () => command("/plan"));
    assert.equal(app.get().mode, "default");
    await act(async () => command("/review"));
    assert.equal(app.get().panel, "changes");
    assert.deepEqual(
      requests.findLast((r) => r.method === "review/start").params.target,
      { type: "uncommittedChanges" },
    );
    await act(async () => command("/status"));
    assert.equal(app.get().modal.type, "settings");
    await act(async () => command("/rename"));
    assert.equal(app.get().modal.type, "rename");

    await act(async () => command("/goal 完成全部回归"));
    assert.deepEqual(
      requests.findLast((r) => r.method === "thread/goal/set").params,
      {
        threadId: thread.id,
        origin: "user",
        objective: "完成全部回归",
        status: "active",
      },
    );
    await act(async () => command("/goal pause"));
    assert.equal(goal.status, "paused");
    await act(async () => command("/goal resume"));
    assert.equal(goal.status, "active");
    await assert.rejects(command("/goal " + "长".repeat(4001)), /最多 4000/);
    fail = "thread/goal/set";
    await assert.rejects(command("/goal 重试目标"), /模拟请求失败/);
    assert.equal(app.get().draft, "/goal 重试目标");
    fail = "";
    await act(async () => command("/goal edit"));
    app.setDraft("保留主草稿");
    await open();
    await act(async () =>
      view.root
        .findByType("textarea")
        .props.onChange({ target: { value: "编辑后的目标" } }),
    );
    await act(async () =>
      view.root
        .findByType("input")
        .props.onChange({ target: { value: "5000" } }),
    );
    fail = "thread/goal/set";
    await act(async () =>
      view.root.findByType("form").props.onSubmit({ preventDefault() {} }),
    );
    assert(JSON.stringify(view.toJSON()).includes("模拟请求失败"));
    assert.equal(view.root.findByType("textarea").props.value, "编辑后的目标");
    fail = "";
    await act(async () =>
      view.root.findByType("form").props.onSubmit({ preventDefault() {} }),
    );
    assert.equal(goal.objective, "编辑后的目标");
    assert.equal(goal.tokenBudget, 5000);
    assert.equal(goal.origin, "user");
    await act(async () => button("暂停目标").props.onClick());
    assert.equal(goal.status, "paused");
    assert.equal(app.get().draft, "保留主草稿");
    assert.deepEqual(app.get().attachments, [attachment]);
    await close();
    await act(async () => command("/goal clear"));
    assert.equal(goal, null);
    app.set({ current: null, projectless: false });
    await act(async () => command("/goal 新对话目标"));
    assert.equal(app.get().current.id, thread.id);
    assert.equal(goal.objective, "新对话目标");
    assert.equal(app.get().draft, "");

    await act(async () => command("/stop"));
    await open();
    assert(JSON.stringify(view.toJSON()).includes("npm run watch"));
    assert(
      requests.some(
        (r) =>
          r.method === "thread/backgroundTerminals/list" &&
          r.params.cursor === "page-2",
      ),
    );
    await act(async () => app.setDraft("清理期间的草稿"));
    fail = "thread/backgroundTerminals/clean";
    await act(async () => button("停止全部后台终端").props.onClick());
    assert.equal(terminals.length, 2);
    assert(JSON.stringify(view.toJSON()).includes("模拟请求失败"));
    fail = "";
    await act(async () => button("停止全部后台终端").props.onClick());
    assert.equal(terminals.length, 0);
    assert.deepEqual(
      requests.findLast((r) => r.method === "thread/backgroundTerminals/clean")
        .params,
      { threadId: thread.id },
    );
    assert.equal(
      requests.slice(start).some((r) => r.method === "turn/interrupt"),
      false,
    );
    assert.equal(app.get().draft, "清理期间的草稿");
    assert.deepEqual(app.get().attachments, [attachment]);
    await close();
    await testNativeCommands(app, requests, setResponse);
    console.log(
      "PASS 18 个命令与零别名、移除命令拒绝执行、原有入口、init 保护与重试、目标编辑与预算、后台终端分页清理",
    );
  } finally {
    if (view) await close();
    app.set(original);
  }
}
