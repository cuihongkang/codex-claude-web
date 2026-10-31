import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { setTimeout as delay } from "node:timers/promises";
import { testMermaid } from "./mermaid.mjs";
import { testMessageImages } from "./message-image.mjs";
import { testMarkdownHtml } from "./markdown-html.mjs";
import { testToolActivities } from "./tool-activities.mjs";
import { testThreadAccess } from "./thread-access.mjs";
import { testThreadArchive } from "./thread-archive.mjs";
import { testThreadUnread } from "./thread-unread.mjs";
import { testThreadNames } from "./thread-names.mjs";
import { testForkTitles } from "./fork-titles.mjs";
import { testAnnotations } from "./annotations.mjs";
import { testUserMessage } from "./user-message.mjs";
import { testFilePanel } from "./file-panel.mjs";
import { testFileChanges } from "./file-changes.mjs";
import { testProcessTiming } from "./process-timing.mjs";
import { testQuestions } from "./questions.mjs";
import { testConnectionLifecycle } from "./connection-lifecycle.mjs";
import { testConnectionRecovery } from "./connection-recovery.mjs";
import { testAccountUsage } from "./account-usage.mjs";
import { testHistory } from "./history.mjs";
import { testHistoryTranslations } from "./history-translations.mjs";
import { testConversationScroll } from "./conversation-scroll.mjs";
import { testComposerPerformance } from "./composer-performance.mjs";
import { testMessageNavigation } from "./message-navigation.mjs";
import { testContextPanel } from "./context-panel.mjs";
import { testCommands } from "./commands.mjs";
import { testCompaction } from "./compaction.mjs";
import { testCompactionRecovery } from "./compaction-recovery.mjs";
import {
  PROJECTLESS_SOURCE,
  projectGroups,
} from "../../client/src/thread-order.js";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k),
};
globalThis.location = { protocol: "http:", host: "component-test" };
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.testTerminals = [];
const requests = [];
let socket;
let responseFor = (m) =>
  m.method === "thread/list" ? { data: [], nextCursor: null } : {};
globalThis.WebSocket = class {
  static OPEN = 1;
  readyState = 1;
  constructor() {
    socket = this;
  }
  send(raw) {
    const m = JSON.parse(raw);
    requests.push(m);
    if (!m.method || m.method === "command/exec") return;
    Promise.resolve(responseFor(m)).then((result) =>
      this.onmessage({
        data: JSON.stringify({
          id: m.id,
          ...(result.error ? { error: result.error } : { result }),
        }),
      }),
    );
  }
  emit(method, params, id) {
    return this.onmessage({ data: JSON.stringify({ method, params, id }) });
  }
};
localStorage.setItem(
  "cx-summary-zh-v1",
  JSON.stringify([["Reviewing local configuration", "历史缓存不应展示"]]),
);
const app = await import(
  pathToFileURL(process.env.CODEX_COMPONENT_BUNDLE).href
);
assert.equal(storage.has("cx-summary-zh-v1"), false);
await testMermaid(app);
{
  const previousResponse = responseFor;
  try {
    await testAccountUsage(
      app,
      requests,
      (respond) => (responseFor = respond),
      (method, params) => socket.emit(method, params),
    );
    await testCommands(
      app,
      requests,
      (respond) => (responseFor = respond),
      (method, params) => socket.emit(method, params),
    );
    await testCompaction(
      app,
      requests,
      (respond) => (responseFor = respond),
      (method, params) => socket.emit(method, params),
    );
    await testCompactionRecovery(
      app,
      requests,
      (respond) => (responseFor = respond),
      (method, params) => socket.emit(method, params),
      () => socket,
    );
    await testHistory(
      app,
      requests,
      (respond) => (responseFor = respond),
      (method, params) => socket.emit(method, params),
    );
    await testConversationScroll(app);
    await testComposerPerformance(app);
    await testHistoryTranslations(app);
    await testMessageNavigation(app);
    await testContextPanel(
      app,
      requests,
      (respond) => (responseFor = respond),
      (method, params) => socket.emit(method, params),
    );
    await testThreadAccess(
      app,
      requests,
      (respond) => (responseFor = respond),
      (method, params) => socket.emit(method, params),
    );
    await testThreadArchive(
      app,
      requests,
      (respond) => (responseFor = respond),
      (method, params) => socket.emit(method, params),
    );
    await testForkTitles(app, requests, (respond) => (responseFor = respond));
    await testThreadUnread(
      app,
      (respond) => (responseFor = respond),
      (method, params) => socket.emit(method, params),
    );
    await testThreadNames(
      app,
      (respond) => (responseFor = respond),
      (method, params) => socket.emit(method, params),
    );
    await testMessageImages(
      app,
      requests,
      (respond) => (responseFor = respond),
    );
    await testMarkdownHtml(app, requests, (respond) => (responseFor = respond));
    await testToolActivities(
      app,
      requests,
      (respond) => (responseFor = respond),
      (method, params) => socket.emit(method, params),
    );
    await testAnnotations(app, requests, (respond) => (responseFor = respond));
    await testUserMessage(app, requests, (respond) => (responseFor = respond));
    await testFilePanel(app, requests, (respond) => (responseFor = respond));
    await testFileChanges(
      app,
      requests,
      (respond) => (responseFor = respond),
      (method, params) => socket.emit(method, params),
    );
    await testProcessTiming(
      app,
      requests,
      (respond) => (responseFor = respond),
      (method, params) => socket.emit(method, params),
    );
    await testQuestions(
      app,
      requests,
      (respond) => (responseFor = respond),
      (method, params) => socket.emit(method, params),
    );
    await testConnectionLifecycle(
      app,
      requests,
      (respond) => (responseFor = respond),
      (method, params) => socket.emit(method, params),
      () => socket,
    );
    await testConnectionRecovery(
      app,
      requests,
      (respond) => (responseFor = respond),
      (method, params) => socket.emit(method, params),
    );
  } finally {
    responseFor = previousResponse;
  }
}
{
  const models = [
    {
      id: "speed-model",
      model: "speed-model",
      displayName: "Speed Model",
      defaultReasoningEffort: "high",
      serviceTiers: [
        { id: "priority", name: "Fast", description: "更快，增加用量" },
        { id: "ultrafast", name: "Ultra Fast", description: "最高速度" },
      ],
    },
    { id: "standard-model", model: "standard-model", serviceTiers: [] },
    {
      id: "legacy-model",
      model: "legacy-model",
      additionalSpeedTiers: ["fast"],
    },
  ];
  const thread = { id: "speed-thread", cwd: "/speed-test", createdAt: 1 };
  let resumedTier = "priority";
  let turnFails = false;
  responseFor = ({ method }) => {
    if (method === "model/list") return { data: models };
    if (method === "config/read")
      return { config: { model: models[0].model, service_tier: "priority" } };
    if (method === "lan/projectless/read") return { directories: {} };
    if (method === "thread/start") return { thread };
    if (method === "thread/resume" || method === "thread/read")
      return { thread, model: models[0].model, serviceTier: resumedTier };
    if (method === "turn/start" && turnFails)
      return { error: { message: "模拟发送失败" } };
    if (
      [
        "thread/list",
        "thread/turns/list",
        "thread/items/list",
        "skills/list",
      ].includes(method)
    )
      return { data: [] };
    return {};
  };
  const connectionState = (ready) => ({
    ready,
    defaultCwd: "/default",
    activeTurns: {},
    questions: [],
  });
  let speedView;
  await act(async () => {
    socket.emit("lan/state", connectionState(true));
    speedView = create(React.createElement(app.Composer));
  });
  const speedToggle = () =>
    speedView.root.findByProps({ "aria-label": "速度模式" });
  assert.equal(app.get().serviceTier, "priority");
  assert.equal(speedToggle().props["aria-pressed"], true);
  assert(JSON.stringify(speedView.toJSON()).includes("Fast"));
  assert.equal(speedToggle().type, "button");
  assert.equal(speedToggle().findAllByType("select").length, 0);
  assert.equal(
    speedToggle().findAllByType("svg")[0].props.fill,
    "currentColor",
  );
  assert.equal(speedView.root.findAllByProps({ title: "选择技能" }).length, 0);

  await act(async () => speedToggle().props.onClick());
  await act(async () => socket.emit("lan/state", connectionState(false)));
  await act(async () => socket.emit("lan/state", connectionState(true)));
  assert.equal(app.get().serviceTier, null);
  assert.equal(speedToggle().props["aria-pressed"], false);
  assert.equal(speedToggle().findAllByType("svg")[0].props.fill, "none");
  await act(async () => {
    app.newChat(thread.cwd);
    app.setDraft("以标准速度新建");
    assert.equal(await app.sendMessage(), true);
  });
  assert.equal(
    requests.findLast((m) => m.method === "thread/start").params.serviceTier,
    null,
  );
  assert.equal(
    requests.findLast((m) => m.method === "turn/start").params.serviceTier,
    null,
  );
  await act(async () => socket.emit("lan/state", connectionState(false)));
  await act(async () => socket.emit("lan/state", connectionState(true)));
  assert.equal(app.get().current.id, thread.id);
  assert.equal(app.get().serviceTier, null);
  assert.equal(speedToggle().props["aria-pressed"], false);

  resumedTier = "fast";
  await act(async () => app.openThread(thread.id));
  assert.equal(speedToggle().props["aria-pressed"], true);
  await act(async () => {
    app.setDraft("恢复 Fast 后发送");
    assert.equal(await app.sendMessage(), true);
  });
  assert.equal(
    requests.findLast((m) => m.method === "turn/start").params.serviceTier,
    "priority",
  );
  resumedTier = null;
  await act(async () => app.openThread(thread.id));
  assert.equal(app.get().serviceTier, null);
  assert.equal(speedToggle().props["aria-pressed"], false);
  await act(async () =>
    socket.emit("thread/settings/updated", {
      threadId: "other-speed-thread",
      threadSettings: { serviceTier: "priority" },
    }),
  );
  assert.equal(app.get().serviceTier, null);
  await act(async () =>
    socket.emit("thread/settings/updated", {
      threadId: thread.id,
      threadSettings: { serviceTier: "priority" },
    }),
  );
  assert.equal(speedToggle().props["aria-pressed"], true);
  await act(async () =>
    socket.emit("thread/settings/updated", {
      threadId: thread.id,
      threadSettings: { serviceTier: null },
    }),
  );
  assert.equal(speedToggle().props["aria-pressed"], false);

  await act(async () => speedToggle().props.onClick());
  await act(async () => {
    app.newChat(thread.cwd);
    app.setDraft("新建 Fast 对话");
    assert.equal(await app.sendMessage(), true);
  });
  assert.equal(
    requests.findLast((m) => m.method === "thread/start").params.serviceTier,
    "priority",
  );
  assert.equal(
    requests.findLast((m) => m.method === "turn/start").params.serviceTier,
    "priority",
  );
  await act(async () => {
    app.set({ active: { [thread.id]: "running-speed-turn" } });
    speedToggle().props.onClick();
    app.setDraft("运行中补充");
    assert.equal(await app.sendMessage(), true);
  });
  const steer = requests.findLast((m) => m.method === "turn/steer");
  assert.equal(steer.params.expectedTurnId, "running-speed-turn");
  assert(!Object.hasOwn(steer.params, "serviceTier"));
  await act(async () => {
    app.set({ active: {} });
    app.setDraft("下一轮标准速度");
    turnFails = true;
    assert.equal(await app.sendMessage(), false);
    assert.equal(app.get().serviceTier, null);
    turnFails = false;
    assert.equal(await app.sendMessage(), true);
  });
  assert.equal(
    requests.findLast((m) => m.method === "turn/start").params.serviceTier,
    null,
  );

  resumedTier = "ultrafast";
  await act(async () => app.openThread(thread.id));
  assert.equal(speedToggle().props["aria-pressed"], true);
  assert(speedToggle().props.title.includes("Ultra Fast"));
  await act(async () => {
    app.setDraft("模型目录中的其他速度");
    assert.equal(await app.sendMessage(), true);
  });
  assert.equal(
    requests.findLast((m) => m.method === "turn/start").params.serviceTier,
    "ultrafast",
  );
  await act(async () =>
    speedView.root
      .findByProps({ "aria-label": "模型" })
      .props.onChange({ target: { value: "standard-model" } }),
  );
  assert.equal(app.get().serviceTier, null);
  assert.equal(speedToggle().props.disabled, true);
  await act(async () =>
    speedView.root
      .findByProps({ "aria-label": "模型" })
      .props.onChange({ target: { value: "legacy-model" } }),
  );
  assert.equal(speedToggle().props.disabled, false);
  await act(async () => {
    speedToggle().props.onClick();
    app.selectModel(models[0]);
  });
  assert.equal(app.get().serviceTier, "priority");
  assert.equal(app.get().effort, "high");
  resumedTier = "custom-speed";
  await act(async () => app.openThread(thread.id));
  assert.equal(speedToggle().props["aria-pressed"], true);
  assert(JSON.stringify(speedView.toJSON()).includes("custom-speed"));
  await act(async () => speedToggle().props.onClick());
  assert.equal(app.get().serviceTier, null);
  assert.equal(speedToggle().props["aria-pressed"], false);
  await act(async () => {
    speedView.unmount();
    app.newChat("/default");
    app.set({
      models: [],
      model: "",
      effort: "",
      serviceTier: null,
      threads: [],
      items: [],
      error: "",
    });
  });
  responseFor = (m) => (m.method === "thread/list" ? { data: [] } : {});
  requests.length = 0;
  console.log(
    "PASS 闪电按钮切换与状态、移除技能按钮、Fast 配置和发送、恢复与通知同步、重连及失败重试",
  );
}
{
  const models = [
    {
      id: "effort-model",
      model: "effort-model",
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh"].map(
        (reasoningEffort) => ({ reasoningEffort }),
      ),
    },
    {
      id: "other-effort-model",
      model: "other-effort-model",
      defaultReasoningEffort: "none",
      supportedReasoningEfforts: ["none", "high", "ultra"].map(
        (reasoningEffort) => ({ reasoningEffort }),
      ),
    },
    {
      id: "fixed-effort-model",
      model: "fixed-effort-model",
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: [{ reasoningEffort: "high" }],
    },
  ];
  app.set({
    models,
    model: models[0].model,
    effort: "",
    current: { id: "effort-fixture" },
    items: [],
    active: {},
  });
  responseFor = (m) =>
    ["thread/list", "thread/turns/list"].includes(m.method) ? { data: [] } : {};
  let effortView;
  await act(async () => {
    effortView = create(React.createElement(app.Composer));
  });
  const trigger = () =>
    effortView.root.findByProps({ "aria-label": "调整思考强度" });
  const range = () => effortView.root.findByProps({ type: "range" });
  assert.equal(effortView.root.findAllByProps({ type: "range" }).length, 0);
  assert.equal(trigger().props.title, "思考强度：高");
  await act(async () => trigger().props.onClick());
  assert.equal(trigger().props["aria-expanded"], true);
  assert.deepEqual(
    [
      range().props.min,
      range().props.max,
      range().props.step,
      range().props.value,
    ],
    [0, 3, 1, 2],
  );
  assert.equal(range().props["aria-valuetext"], "高");
  assert.equal(
    effortView.root.findAll(
      (n) => n.type === "select" && n.props["aria-label"] === "思考强度",
    ).length,
    0,
  );
  await act(async () => {
    range().props.onChange({ target: { value: "0" } });
    app.setDraft("滑块选择低强度");
    assert.equal(await app.sendMessage(), true);
  });
  const low = requests.findLast((m) => m.method === "turn/start").params;
  assert.equal(low.effort, "low");
  assert.equal(low.collaborationMode.settings.reasoning_effort, "low");
  assert.equal(range().props["aria-valuetext"], "低");
  await act(async () => range().props.onChange({ target: { value: "3" } }));
  assert.equal(app.get().effort, "xhigh");
  assert.equal(trigger().props.title, "思考强度：极高");
  await act(async () =>
    effortView.root
      .findByProps({ "aria-label": "模型" })
      .props.onChange({ target: { value: models[1].model } }),
  );
  assert.equal(trigger().props["aria-expanded"], false);
  await act(async () => trigger().props.onClick());
  assert.deepEqual(
    [range().props.max, range().props.value, range().props["aria-valuetext"]],
    [2, 0, "无"],
  );
  await act(async () => {
    range().props.onChange({ target: { value: "2" } });
    app.setDraft("按模型档位发送超高强度");
    assert.equal(await app.sendMessage(), true);
  });
  assert.equal(
    requests.findLast((m) => m.method === "turn/start").params.effort,
    "ultra",
  );
  let stopped = false;
  await act(async () =>
    effortView.root
      .findByProps({ className: "reasoning-effort" })
      .props.onKeyDown({
        key: "Escape",
        stopPropagation() {
          stopped = true;
        },
      }),
  );
  assert(stopped);
  assert.equal(trigger().props["aria-expanded"], false);
  await act(async () => trigger().props.onClick());
  await act(async () =>
    effortView.root
      .findByProps({ className: "reasoning-effort" })
      .props.onBlur({
        currentTarget: { contains: () => false },
        relatedTarget: null,
      }),
  );
  assert.equal(trigger().props["aria-expanded"], false);
  await act(async () => app.selectModel(models[2]));
  assert.equal(trigger().props.disabled, true);
  let inlineView;
  await act(async () => {
    inlineView = create(
      React.createElement(app.ReasoningEffortControl, { inline: true }),
    );
  });
  assert.equal(
    inlineView.root.findByProps({ type: "range" }).props.disabled,
    true,
  );
  await act(async () => app.selectModel(models[0]));
  assert.equal(inlineView.root.findAllByType("button").length, 0);
  await act(async () =>
    inlineView.root
      .findByProps({ type: "range" })
      .props.onChange({ target: { value: "1" } }),
  );
  assert.equal(app.get().effort, "medium");
  assert.equal(trigger().props.title, "思考强度：中");
  await act(async () => {
    inlineView.unmount();
    effortView.unmount();
    app.newChat("/default");
    app.set({
      models: [],
      model: "",
      effort: "",
      threads: [],
      items: [],
      error: "",
    });
  });
  responseFor = (m) => (m.method === "thread/list" ? { data: [] } : {});
  requests.length = 0;
  console.log(
    "PASS 思考强度滑块默认档位、模型支持范围、拖动发送、模型切换、收起交互及弹窗共用状态",
  );
}
let projectView;
app.set({ defaultCwd: "/default", cwd: "/previous-project" });
await act(async () => {
  projectView = create(
    React.createElement(app.ProjectGroup, { path: "" }, "无项目对话"),
  );
});
assert(JSON.stringify(projectView.toJSON()).includes("未分类"));
assert(JSON.stringify(projectView.toJSON()).includes("无项目对话"));
assert.equal(projectView.root.findAllByType("button").length, 2);
await act(async () =>
  projectView.root
    .findByProps({ title: "在 未分类 中新建对话" })
    .props.onClick(),
);
assert.equal(app.get().projectless, true);
assert.equal(app.get().cwd, "/default");
assert.equal(app.get().current, null);
assert.equal(
  requests.filter((r) => r.method === "lan/projectless/prepare").length,
  0,
);
await act(async () =>
  projectView.root.findByProps({ title: "未指定项目的对话" }).props.onClick(),
);
assert(!JSON.stringify(projectView.toJSON()).includes("无项目对话"));
await act(async () => projectView.unmount());
await act(async () => {
  projectView = create(
    React.createElement(app.ProjectGroup, { path: "/code/x" }, "项目对话"),
  );
});
assert.equal(projectView.root.findAllByType("button").length, 2);
await act(async () =>
  projectView.root.findByProps({ title: "在 x 中新建对话" }).props.onClick(),
);
assert.equal(app.get().cwd, "/code/x");
assert.equal(app.get().projectless, false);
await act(async () => app.newChat(undefined, { reuseDirectory: true }));
assert.equal(app.get().current, null);
assert.equal(app.get().cwd, "/code/x");
assert.equal(app.get().projectless, false);
assert.equal(app.get().projectlessCwd, null);
await act(async () => projectView.unmount());
console.log("PASS 未分类分组展示与折叠、实际项目目录和新建对话入口");

{
  const root = "/codex/codex-web/workspaces";
  const thread = {
    id: "new-projectless",
    cwd: root + "/chat-ABC123",
    threadSource: PROJECTLESS_SOURCE,
    originator: "codex_lan_web",
    source: "vscode",
    createdAt: 1,
    updatedAt: 1,
  };
  let prepareFails = true,
    startFails = true,
    preparations = 0;
  responseFor = ({ method }) => {
    if (method === "lan/projectless/prepare") {
      preparations++;
      return prepareFails
        ? { error: { message: "目录不可写" } }
        : { cwd: thread.cwd, root };
    }
    if (method === "thread/start")
      return startFails ? { error: { message: "创建暂时失败" } } : { thread };
    if (method === "thread/resume" || method === "thread/read")
      return { thread, cwd: thread.cwd };
    if (method === "thread/list")
      return { data: [{ ...thread, threadSource: null }] };
    if (method === "thread/turns/list" || method === "thread/items/list")
      return { data: [] };
    if (method === "lan/projectless/read") return { directories: {} };
    if (method === "turn/start")
      return { turn: { id: "projectless-turn", status: "inProgress" } };
    return {};
  };
  app.set({
    connected: true,
    model: "fixture-model",
    projects: [],
    threads: [],
    archived: false,
    search: "",
    active: {},
  });
  app.newChat("");
  app.newChat(undefined, { reuseDirectory: true });
  assert.equal(app.get().projectless, true);
  assert.equal(app.get().projectlessCwd, null);
  assert.equal(app.get().cwd, "/default");
  app.setDraft("创建无项目对话");
  const startCount = requests.filter((r) => r.method === "thread/start").length;
  assert.equal(await app.sendMessage(), false);
  assert.equal(
    requests.filter((r) => r.method === "thread/start").length,
    startCount,
  );
  assert.equal(app.get().draft, "创建无项目对话");
  assert.equal(localStorage.getItem("cx-draft-new"), "创建无项目对话");
  prepareFails = false;
  assert.equal(await app.sendMessage(), false);
  assert.equal(app.get().projectlessCwd, thread.cwd);
  assert.equal(localStorage.getItem("cx-draft-new"), "创建无项目对话");
  startFails = false;
  assert.equal(await app.sendMessage(), true);
  assert.equal(app.get().draft, "");
  assert.equal(localStorage.getItem("cx-draft-new"), null);
  assert.equal(preparations, 2);
  const start = requests.findLast((r) => r.method === "thread/start");
  assert.equal(start.params.cwd, thread.cwd);
  assert.equal(start.params.threadSource, PROJECTLESS_SOURCE);
  assert.equal(start.params.approvalPolicy, "never");
  assert.equal(start.params.sandbox, "danger-full-access");
  assert.equal(app.get().cwd, thread.cwd);
  await app.loadThreads();
  assert.equal(app.get().threads[0].threadSource, null);
  assert.deepEqual(
    projectGroups(app.get().threads, [], [], {}, root).map(([path]) => path),
    [""],
  );
  app.set({ current: null, projectless: false });
  await app.openThread(thread.id);
  assert.equal(app.get().projectless, true);
  assert.equal(
    projectGroups(
      app.get().threads,
      [],
      [],
      app.get().projectlessDirectories,
      root,
    )[0][0],
    "",
  );
  app.newChat();
  assert.equal(app.get().draft, "");
  assert.equal(app.get().projectless, true);
  assert.equal(app.get().projectlessCwd, null);
  await app.openThread(thread.id);
  const previousPreparations = preparations;
  app.newChat(undefined, { reuseDirectory: true });
  assert.equal(app.get().current, null);
  assert.equal(app.get().cwd, thread.cwd);
  assert.equal(app.get().projectless, true);
  assert.equal(app.get().projectlessCwd, thread.cwd);
  app.newChat(undefined, { reuseDirectory: true });
  assert.equal(app.get().cwd, thread.cwd);
  assert.equal(app.get().projectlessCwd, thread.cwd);
  await app.ensureThread();
  assert.equal(preparations, previousPreparations);
  const reused = requests.findLast((r) => r.method === "thread/start");
  assert.equal(reused.params.cwd, thread.cwd);
  assert.equal(reused.params.threadSource, PROJECTLESS_SOURCE);
  app.newChat("/code/x");
  app.set({ threads: [], active: {}, error: "", model: "" });
  responseFor = (m) => (m.method === "thread/list" ? { data: [] } : {});
  requests.length = 0;
  console.log(
    "PASS 未分类新建的独立目录、失败重试与草稿保留、统一权限、重新加载归类及当前目录复用",
  );
}
{
  const thread = { id: "draft-thread", cwd: "/code/x", createdAt: 1 };
  let turnFails = true;
  let onSend = () => {};
  responseFor = ({ method }) => {
    if (["thread/start", "thread/resume", "thread/read"].includes(method))
      return { thread, cwd: thread.cwd };
    if (method === "thread/list") return { data: [thread] };
    if (method === "thread/turns/list" || method === "thread/items/list")
      return { data: [] };
    if (method === "lan/projectless/read") return { directories: {} };
    if (method === "turn/start") {
      onSend();
      return turnFails ? { error: { message: "消息发送失败" } } : {};
    }
    return {};
  };
  app.newChat(thread.cwd);
  app.setDraft("尚未发送的首条消息");
  app.newChat();
  assert.equal(app.get().draft, "尚未发送的首条消息");
  assert.equal(await app.sendMessage(), false);
  assert.equal(app.get().current.id, thread.id);
  assert.equal(app.get().draft, "尚未发送的首条消息");
  assert.equal(localStorage.getItem("cx-draft-new"), null);
  assert.equal(
    localStorage.getItem("cx-draft-" + thread.id),
    "尚未发送的首条消息",
  );
  app.newChat();
  assert.equal(app.get().draft, "");
  await app.openThread(thread.id);
  assert.equal(app.get().draft, "尚未发送的首条消息");
  turnFails = false;
  assert.equal(await app.sendMessage(), true);
  assert.equal(app.get().draft, "");
  assert.equal(localStorage.getItem("cx-draft-" + thread.id), null);
  app.newChat();
  assert.equal(app.get().draft, "");
  await app.openThread(thread.id);
  assert.equal(app.get().draft, "");

  app.setDraft("发送后切换对话");
  onSend = () => {
    app.newChat();
    app.setDraft("新对话中的未发送草稿");
  };
  assert.equal(await app.sendMessage(), true);
  assert.equal(app.get().draft, "新对话中的未发送草稿");
  assert.equal(localStorage.getItem("cx-draft-" + thread.id), null);
  await app.openThread(thread.id);
  assert.equal(app.get().draft, "");

  app.setDraft("发送时继续编辑");
  onSend = () => app.setDraft("等待期间输入的下一条草稿");
  assert.equal(await app.sendMessage(), true);
  assert.equal(app.get().draft, "等待期间输入的下一条草稿");
  assert.equal(
    localStorage.getItem("cx-draft-" + thread.id),
    "等待期间输入的下一条草稿",
  );
  app.newChat();
  assert.equal(app.get().draft, "新对话中的未发送草稿");
  await app.openThread(thread.id);
  assert.equal(app.get().draft, "等待期间输入的下一条草稿");
  app.newChat();
  app.setDraft("");
  app.set({ threads: [], active: {}, error: "", items: [] });
  responseFor = (m) => (m.method === "thread/list" ? { data: [] } : {});
  requests.length = 0;
  console.log(
    "PASS 新对话保留未发送草稿、创建后草稿归属、发送失败恢复、成功清理及等待期间的切换和编辑",
  );
}
let versionView;
await act(async () => {
  versionView = create(React.createElement(app.VersionDetails));
});
assert(
  JSON.stringify(versionView.toJSON()).includes("1.2.3+dev.gabc1234.dirty"),
);
assert(JSON.stringify(versionView.toJSON()).includes("等待连接"));
await act(async () => {
  app.set({
    serverVersion: {
      version: "1.2.2",
      displayVersion: "1.2.2",
      revision: "def123456789",
      dirty: false,
      channel: "release",
      builtAt: null,
    },
  });
});
const versionText = JSON.stringify(versionView.toJSON());
assert(versionText.includes("正式发布"));
assert(versionText.includes("def123456789"));
assert(versionText.includes("含未提交修改"));
assert(versionText.includes("1.2.3+dev.gabc1234.dirty"));
await act(async () => versionView.unmount());
console.log("PASS 网页和桥接独立版本、构建来源与未连接状态");
app.set({
  connected: true,
  current: { id: "fixture" },
  active: {},
  items: [
    { id: "empty", type: "reasoning", summary: [] },
    {
      id: "title",
      type: "reasoning",
      summary: ["**识别 Git 分支**"],
    },
    {
      id: "body",
      type: "reasoning",
      summary: ["**验证修改结果**\n\n这里是摘要正文。"],
    },
    {
      id: "progress",
      type: "agentMessage",
      phase: "commentary",
      text: "这是进度内容，默认折叠。",
    },
    {
      id: "answer",
      type: "agentMessage",
      phase: "final_answer",
      text: "最终回答保持展开。",
    },
  ],
});
let view;
await act(async () => {
  view = create(React.createElement(app.Conversation));
});
const tree = view.root;
const group = tree.findByProps({ className: "process-history" });
assert.equal(group.props.open, undefined);
assert.equal(
  tree.findAll((n) => n.props.className === "activity reasoning-summary")
    .length,
  0,
);
assert(!JSON.stringify(view.toJSON()).includes("这是进度内容"));
assert(!JSON.stringify(view.toJSON()).includes("识别 Git 分支"));
assert(!JSON.stringify(view.toJSON()).includes("验证修改结果"));
assert(JSON.stringify(view.toJSON()).includes("最终回答保持展开"));
await act(async () => group.props.onToggle({ currentTarget: { open: true } }));
assert.equal(
  tree.findAllByProps({ className: "process-content process-preview" }).length,
  0,
);
assert.equal(
  tree.findAll((n) => n.props.className === "activity reasoning-summary")
    .length,
  2,
);
assert.equal(
  tree
    .findByProps({ className: "activity-summary reasoning-title" })
    .findAllByType("button").length,
  0,
);
assert(JSON.stringify(view.toJSON()).includes("识别 Git 分支"));
const detail = tree
  .findAllByType("details")
  .find((n) => n.props.className === "activity reasoning-summary");
assert.equal(detail.props.open, undefined);
assert.equal(detail.findByType("summary").props.title, "验证修改结果");
assert(JSON.stringify(view.toJSON()).includes("这是进度内容"));
await act(async () => group.props.onToggle({ currentTarget: { open: false } }));
assert(!JSON.stringify(view.toJSON()).includes("这是进度内容"));
assert(JSON.stringify(view.toJSON()).includes("最终回答保持展开"));
await act(async () => view.unmount());
console.log(
  "PASS 已完成的工作过程完整折叠、展开完整过程、最终回答独立、中文摘要标题",
);
{
  app.set({
    active: { fixture: "live-turn" },
    items: [
      {
        id: "live-progress",
        turnId: "live-turn",
        type: "agentMessage",
        phase: "commentary",
        text: "正在检查项目。",
      },
    ],
  });
  await act(async () => {
    view = create(React.createElement(app.Conversation));
  });
  const emit = async (method, params) =>
    act(async () =>
      socket.emit(method, {
        threadId: "fixture",
        turnId: "live-turn",
        ...params,
      }),
    );
  const visible = () => JSON.stringify(view.toJSON());
  assert(visible().includes("正在处理"));
  assert(visible().includes("正在检查项目"));
  await emit("item/started", {
    item: { id: "live-thought", type: "reasoning", summary: [] },
  });
  assert(visible().includes("正在检查项目"));
  await emit("item/reasoning/summaryTextDelta", {
    itemId: "live-thought",
    summaryIndex: 0,
    delta: "**定位组件**",
  });
  assert(visible().includes("定位组件"));
  assert(!visible().includes("正在检查项目"));
  await emit("item/reasoning/summaryTextDelta", {
    itemId: "live-thought",
    summaryIndex: 1,
    delta: "**验证界面**\n\n检查折叠后的内容。",
  });
  assert(visible().includes("验证界面"));
  assert(!visible().includes("定位组件"));
  await emit("item/reasoning/summaryTextDelta", {
    itemId: "live-thought",
    summaryIndex: 2,
    delta: " ",
  });
  assert(visible().includes("验证界面"));
  await emit("item/started", {
    item: {
      id: "live-tool",
      type: "commandExecution",
      command: "npm run check",
      status: "inProgress",
    },
  });
  assert(visible().includes("运行项目检查"));
  assert(!visible().includes("验证界面"));
  await emit("item/started", {
    item: {
      id: "live-update",
      type: "agentMessage",
      phase: "commentary",
      text: "",
    },
  });
  assert(visible().includes("运行项目检查"));
  await emit("item/agentMessage/delta", {
    itemId: "live-update",
    delta: "验证已完成",
  });
  await emit("item/agentMessage/delta", {
    itemId: "live-update",
    delta: "，准备交付。",
  });
  assert(visible().includes("验证已完成，准备交付。"));
  assert(!visible().includes("运行项目检查"));
  await emit("item/completed", {
    item: {
      id: "live-answer",
      type: "agentMessage",
      phase: "final_answer",
      text: "修改完成。",
    },
  });
  await act(async () => app.set({ active: {} }));
  assert(visible().includes("工作过程"));
  assert(!visible().includes("验证已完成，准备交付。"));
  assert(visible().includes("修改完成。"));
  assert.equal(
    view.root.findAllByProps({ className: "process-content process-preview" })
      .length,
    0,
  );
  await act(async () => app.set({ active: { fixture: "next-turn" } }));
  assert(!visible().includes("验证已完成，准备交付。"));
  await act(async () => app.set({ active: {} }));
  await act(async () => view.unmount());
  console.log(
    "PASS 生成时更新最新有效提示、任务完成后收起、后续任务保持历史过程折叠",
  );
}
{
  const previousResponse = responseFor;
  const turnId = "guided-turn";
  const userMessage = (id, text) => ({
    id,
    turnId,
    type: "userMessage",
    content: [{ type: "text", text }],
  });
  app.set({
    current: { id: "fixture" },
    active: { fixture: turnId },
    questions: [],
    items: [
      userMessage("original-request", "请检查机器人通用能力。"),
      {
        id: "initial-progress",
        turnId,
        type: "agentMessage",
        phase: "commentary",
        text: "开始检查模型。",
      },
    ],
  });
  await act(async () => {
    view = create(React.createElement(app.Conversation));
  });
  const history = () => view.root.findByProps({ className: "process-history" });
  const order = () =>
    view.root
      .findByProps({ className: "message-column" })
      .children.filter((node) => node.props?.group || node.props?.item)
      .map((node) =>
        node.props.group
          ? "process"
          : node.findAllByProps({ "aria-label": "回复操作" }).length
            ? "actions"
            : node.props.item.id,
      );
  const emitItem = (item) =>
    act(async () =>
      socket.emit("item/completed", {
        threadId: "fixture",
        turnId,
        item,
      }),
    );
  const originalHistory = history();
  await act(async () =>
    history().props.onToggle({ currentTarget: { open: true } }),
  );
  let finishSteer, sending;
  responseFor = ({ method }) => {
    if (method === "turn/steer")
      return new Promise((resolve) => (finishSteer = resolve));
    if (method === "thread/list" || method === "thread/turns/list")
      return { data: [], nextCursor: null };
    return {};
  };
  await act(async () => {
    app.setDraft("请考虑通用能力。");
    sending = app.sendMessage();
  });
  const pendingMessage = app.get().items.find((item) => item.optimistic);
  assert.equal(pendingMessage.turnId, turnId);
  assert.deepEqual(order(), ["original-request", pendingMessage.id, "process"]);
  assert.equal(history(), originalHistory);
  assert(JSON.stringify(view.toJSON()).includes("开始检查模型。"));
  await act(async () => {
    finishSteer({});
    assert.equal(await sending, true);
  });
  await emitItem(userMessage("first-steer", "请考虑通用能力。"));
  await emitItem({
    id: "guided-command",
    type: "commandExecution",
    command: "npm run check",
    status: "completed",
  });
  await emitItem(userMessage("last-steer", "同时检查内存占用。"));
  await emitItem({
    id: "latest-progress",
    type: "agentMessage",
    phase: "commentary",
    text: "继续验证能力上限。",
  });
  assert.deepEqual(order(), [
    "original-request",
    "first-steer",
    "last-steer",
    "process",
  ]);
  assert.equal(history(), originalHistory);
  assert.equal(
    history().findAllByProps({ className: "user-bubble" }).length,
    0,
  );
  assert.equal(
    view.root.findAllByProps({ className: "user-bubble" }).length,
    3,
  );
  assert(JSON.stringify(view.toJSON()).includes("开始检查模型。"));
  assert(JSON.stringify(view.toJSON()).includes("继续验证能力上限。"));
  await act(async () =>
    history().props.onToggle({ currentTarget: { open: false } }),
  );
  assert(!JSON.stringify(view.toJSON()).includes("开始检查模型。"));
  assert(JSON.stringify(view.toJSON()).includes("继续验证能力上限。"));
  await emitItem({
    id: "guided-answer",
    type: "agentMessage",
    phase: "final_answer",
    text: "能力检查完成。",
  });
  await act(async () => app.set({ active: {} }));
  const expectedOrder = [
    "original-request",
    "first-steer",
    "last-steer",
    "process",
    "guided-answer",
    "actions",
  ];
  assert.deepEqual(order(), expectedOrder);
  assert.equal(
    view.root.findAllByProps({ className: "process-history" }).length,
    1,
  );
  assert(!JSON.stringify(view.toJSON()).includes("继续验证能力上限。"));
  const savedItems = app.get().items;
  responseFor = ({ method }) =>
    method === "thread/items/list"
      ? {
          data: savedItems
            .slice()
            .reverse()
            .map(({ turnId, ...item }) => ({ turnId, item })),
          nextCursor: null,
        }
      : {};
  await act(async () => {
    app.set({ items: [] });
    await app.loadHistory();
  });
  assert.deepEqual(order(), expectedOrder);
  assert.equal(
    view.root.findAllByProps({ className: "process-history" }).length,
    1,
  );
  await act(async () => view.unmount());
  responseFor = previousResponse;
  console.log(
    "PASS 多条引导保持气泡、过程始终位于最后一条引导下方、流式与历史汇总一致、展开状态保留",
  );
}
{
  const command = "/usr/bin/zsh -lc \"sed -n '20,40p' src/app.js\"";
  const description = "读取 src/app.js 的第 20–40 行";
  app.set({
    active: { fixture: "command-turn" },
    items: [
      {
        id: "read-command",
        turnId: "command-turn",
        type: "commandExecution",
        status: "completed",
        command,
        aggregatedOutput: "file contents",
        exitCode: 0,
        cwd: "/code/example",
      },
    ],
  });
  await act(async () => {
    view = create(React.createElement(app.Conversation));
  });
  const summary = () =>
    view.root.findByProps({
      className: "activity-summary",
      title: command,
    });
  assert.equal(summary().findByType("span").children.join(""), description);
  assert.equal(view.root.findAllByType("pre").length, 0);
  await act(async () => summary().props.onClick());
  assert.deepEqual(
    view.root.findAllByType("pre").map((node) => node.children.join("")),
    [command, "file contents"],
  );
  assert(
    view.root
      .findAllByType("small")
      .some((node) => node.children.join("").includes("退出码 0")),
  );
  assert(JSON.stringify(view.toJSON()).includes("/code/example"));
  await act(async () => app.set({ active: {} }));
  assert.equal(view.root.findAllByType("pre").length, 0);
  await act(async () =>
    view.root
      .findByProps({ className: "process-history" })
      .props.onToggle({ currentTarget: { open: true } }),
  );
  assert.equal(summary().findByType("span").children.join(""), description);
  await act(async () => summary().props.onClick());
  assert.equal(view.root.findAllByType("pre")[0].children.join(""), command);
  const skillCommand = "cat /skills/example/SKILL.md";
  await act(async () =>
    app.set({
      active: { fixture: "skill-turn" },
      items: [
        {
          id: "skill-command",
          turnId: "skill-turn",
          type: "commandExecution",
          command: skillCommand,
          status: "inProgress",
        },
      ],
    }),
  );
  const skillSummary = view.root.findByProps({
    className: "activity-summary",
    title: skillCommand,
  });
  assert.equal(
    skillSummary.findByType("span").children.join(""),
    "阅读技能 example",
  );
  await act(async () => skillSummary.props.onClick());
  assert.equal(
    view.root.findAllByType("pre")[0].children.join(""),
    skillCommand,
  );
  await act(async () =>
    app.set({
      items: [
        {
          id: "git-command",
          turnId: "skill-turn",
          type: "commandExecution",
          command: "git diff --check; pwd",
          status: "completed",
        },
      ],
    }),
  );
  assert.equal(
    view.root
      .findByProps({
        className: "activity-summary",
        title: "git diff --check; pwd",
      })
      .findByType("span")
      .children.join(""),
    "检查差异的空白错误；查看当前工作目录",
  );
  await act(async () => app.set({ active: {} }));
  await act(async () => view.unmount());
  console.log(
    "PASS 命令描述用于实时提示和历史记录，展开保留原始命令、输出与退出状态",
  );
}
{
  const originalFetch = globalThis.fetch;
  const batches = [];
  const requestCount = requests.length;
  let finishBody;
  let endpointMissing = false;
  const translations = new Map([
    ["Reviewing local configuration", "检查本地配置"],
    ["Inspecting application settings", "检查应用设置"],
    ["Inspecting application settings and storage", "检查应用设置与存储"],
    ["Checking latest headings", "检查最新标题"],
    ["Recovering translation", "恢复翻译"],
    ["Streaming summary", "持续更新的摘要"],
    [
      "Streaming summary with more text and final details",
      "包含最终细节的摘要",
    ],
  ]);
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/translate");
    const { texts } = JSON.parse(options.body);
    batches.push(texts);
    if (endpointMissing && texts.includes("Recovering translation"))
      return new Response("Not found", { status: 404 });
    if (texts.includes("Streaming summary"))
      await new Promise((resolve) => (finishBody = resolve));
    return new Response(
      JSON.stringify({
        translations: texts.map((text) => translations.get(text)),
      }),
    );
  };
  app.set({
    active: { fixture: "translation-turn" },
    items: [
      {
        id: "machine-translation",
        turnId: "translation-turn",
        type: "reasoning",
        summary: [
          "Reviewing local configuration\nInspecting application settings",
        ],
      },
    ],
  });
  await act(async () => {
    view = create(React.createElement(app.Conversation));
  });
  const history = () => view.root.findByProps({ className: "process-history" });
  const summary = () =>
    view.root.findByProps({ className: "activity reasoning-summary" });
  const visible = () => JSON.stringify(view.toJSON());
  assert.equal(history().props.open, undefined);
  assert.equal(summary().props.open, undefined);
  await act(async () => delay(50));
  assert.deepEqual(batches, [["Reviewing local configuration"]]);
  assert(visible().includes("检查本地配置"));
  await act(async () => delay(150));
  assert.deepEqual(batches, [
    ["Reviewing local configuration"],
    ["Inspecting application settings"],
  ]);
  assert(visible().includes("检查本地配置"));
  assert(visible().includes("检查应用设置"));
  assert(!visible().includes("正在翻译摘要"));

  await act(async () =>
    history().props.onToggle({ currentTarget: { open: true } }),
  );
  await act(async () => delay(150));
  assert(visible().includes("检查应用设置"));
  assert(!visible().includes("正在翻译摘要"));
  assert.equal(batches.length, 2);
  await act(async () =>
    history().props.onToggle({ currentTarget: { open: false } }),
  );
  await act(async () =>
    app.set({
      items: [
        {
          ...app.get().items[0],
          summary: [
            "Reviewing local configuration\nInspecting application settings and storage",
          ],
        },
      ],
    }),
  );
  assert.equal(summary().props.open, undefined);
  await act(async () => delay(400));
  assert.deepEqual(batches, [
    ["Reviewing local configuration"],
    ["Inspecting application settings"],
    ["Inspecting application settings and storage"],
  ]);
  assert(visible().includes("检查应用设置与存储"));
  await act(async () => app.set({ active: {} }));
  await act(async () =>
    history().props.onToggle({ currentTarget: { open: true } }),
  );
  await act(async () => delay(150));
  assert(visible().includes("检查应用设置与存储"));
  assert(!visible().includes("正在翻译摘要"));
  await act(async () => delay(150));
  assert.equal(batches.length, 3);

  const updateSummary = (title, body) =>
    act(async () =>
      app.set({
        items: [{ ...app.get().items[0], summary: [`${title}\n${body}`] }],
      }),
    );
  await updateSummary("Reviewing local configuration", "Streaming summary");
  await act(async () => delay(400));
  assert.equal(typeof finishBody, "function");
  const firstStreamBatch = batches.length - 1;
  await updateSummary(
    "Checking latest headings",
    "Streaming summary with more text",
  );
  await act(async () => delay(50));
  assert(visible().includes("检查最新标题"));
  assert.deepEqual(batches.at(-1), ["Checking latest headings"]);
  await updateSummary(
    "Checking latest headings",
    "Streaming summary with more text and final details",
  );
  assert.equal(batches.length, firstStreamBatch + 2);
  await act(async () => finishBody());
  assert(visible().includes("持续更新的摘要"));
  assert(!visible().includes("正在翻译摘要"));
  await act(async () => delay(150));
  assert(visible().includes("包含最终细节的摘要"));
  assert.deepEqual(batches.slice(firstStreamBatch), [
    ["Streaming summary"],
    ["Checking latest headings"],
    ["Streaming summary with more text and final details"],
  ]);
  assert.equal(requests.length, requestCount);
  const completedCount = batches.length;
  await act(async () => app.set({ notice: "验证当前摘要保留译文" }));
  await act(async () => delay(150));
  assert.equal(batches.length, completedCount);
  assert(visible().includes("包含最终细节的摘要"));
  await act(async () => view.unmount());
  await act(async () => {
    app.set({ active: { fixture: "translation-turn" }, notice: "" });
    view = create(React.createElement(app.Conversation));
  });
  await act(async () => delay(150));
  assert.equal(batches.length, completedCount);
  assert(visible().includes("包含最终细节的摘要"));
  assert(!visible().includes("历史缓存不应展示"));
  assert.equal(storage.has("cx-summary-zh-v1"), false);
  endpointMissing = true;
  await updateSummary(
    "Recovering translation",
    "Streaming summary with more text and final details",
  );
  await act(async () => delay(50));
  const retry = view.root
    .findAllByType("button")
    .find((button) => button.children.includes("标题翻译失败，点击重试"));
  assert.match(retry.props.title, /网页服务尚未加载翻译接口/);
  const failedCount = batches.length;
  await act(async () => delay(150));
  assert.equal(batches.length, failedCount);
  endpointMissing = false;
  await act(async () => retry.props.onClick());
  await act(async () => delay(50));
  assert(visible().includes("恢复翻译"));
  assert(!visible().includes("标题翻译失败，点击重试"));
  assert.equal(batches.length, failedCount + 1);
  await act(async () => app.set({ active: {} }));
  await act(async () => view.unmount());
  globalThis.fetch = originalFetch;
  console.log(
    "PASS 思考标题优先、折叠正文翻译与流式更新、清理旧缓存并在重新打开时复用译文、旧服务 404 提示与重试恢复",
  );
}
app.set({ draft: "键盘发送验证", items: [] });
await act(async () => {
  view = create(React.createElement(app.Composer));
});
const event = (extra) => ({
  key: "Enter",
  nativeEvent: { isComposing: false },
  preventDefault() {
    this.prevented = true;
  },
  ...extra,
});
assert.equal(
  view.root.findAll((n) => n.props["aria-label"] === "执行权限").length,
  0,
);
const input = view.root.findByType("textarea");
const enter = event({});
await act(async () => input.props.onKeyDown(enter));
assert(!enter.prevented);
assert(!requests.some((r) => r.method === "turn/start"));
const composing = event({ ctrlKey: true, nativeEvent: { isComposing: true } });
await act(async () => input.props.onKeyDown(composing));
assert(!requests.some((r) => r.method === "turn/start"));
await act(async () => input.props.onKeyDown(event({ ctrlKey: true })));
assert.equal(requests.filter((r) => r.method === "turn/start").length, 1);
assert.equal(
  requests.find((r) => r.method === "turn/start").params.approvalPolicy,
  "never",
);
assert.deepEqual(
  requests.find((r) => r.method === "turn/start").params.sandboxPolicy,
  { type: "dangerFullAccess" },
);
await act(async () => view.unmount());
console.log("PASS Enter 保留换行、中文输入确认不发送、Ctrl+Enter 发送一次");
const originalComputedStyle = globalThis.getComputedStyle;
const originalResizeObserver = globalThis.ResizeObserver;
let terminalTypography = { fontSize: "12px", lineHeight: "12px" };
let resizeTerminal;
globalThis.getComputedStyle = () => terminalTypography;
globalThis.ResizeObserver = class {
  constructor(callback) {
    resizeTerminal = callback;
  }
  observe() {}
  disconnect() {}
};
app.set({ terminalOpen: true });
await act(async () => {
  view = create(React.createElement(app.TerminalPanel), {
    createNodeMock: () => ({}),
  });
});
const first = localStorage.getItem("cx-terminal");
assert(first);
assert.deepEqual(
  requests.find((r) => r.method === "command/exec").params.sandboxPolicy,
  { type: "dangerFullAccess" },
);
assert.equal(testTerminals.at(-1).options.theme.background, "#ffffff");
assert.equal(testTerminals.at(-1).options.fontSize, 12);
assert.equal(testTerminals.at(-1).options.lineHeight, 1);
terminalTypography = { fontSize: "18px", lineHeight: "27px" };
await act(async () => resizeTerminal());
assert.equal(testTerminals.at(-1).options.fontSize, 18);
assert.equal(testTerminals.at(-1).options.lineHeight, 1.5);
await act(async () => testTerminals.at(-1).input("\x04"));
assert.equal(
  Buffer.from(
    requests.findLast((r) => r.method === "command/exec/write").params
      .deltaBase64,
    "base64",
  ).toString(),
  "\x04",
);
await act(async () =>
  socket.emit("lan/terminalExit", { processId: first, exitCode: 0 }),
);
assert.equal(app.get().terminalOpen, false);
assert.equal(localStorage.getItem("cx-terminal"), null);
await act(async () => view.unmount());
app.set({ terminalOpen: true });
await act(async () => {
  view = create(React.createElement(app.TerminalPanel), {
    createNodeMock: () => ({}),
  });
});
assert.notEqual(localStorage.getItem("cx-terminal"), first);
await act(async () => view.unmount());
globalThis.getComputedStyle = originalComputedStyle;
globalThis.ResizeObserver = originalResizeObserver;
console.log(
  "PASS 终端字号与行高同步、白底终端、Ctrl+D 传递、退出自动折叠及清理、重新打开创建新终端",
);

const history = Array.from({ length: 65 }, (_, i) => ({
  id: `sort-${i}`,
  cwd: i === 1 ? "/older-project" : `/project-${i % 2}`,
  createdAt: 100 - i,
  updatedAt: 100 - i,
}));
const completions = new Map(history.map((thread, i) => [thread.id, i + 200]));
let projectlessDirectories = { "sort-0": "/project-0" };
let projectlessUnavailable = false;
responseFor = ({ method, params }) => {
  if (method === "lan/projectless/read")
    return projectlessUnavailable
      ? { error: { message: "分组元数据暂不可用" } }
      : { directories: projectlessDirectories };
  if (method === "thread/list")
    return {
      data: params.cursor ? history.slice(60) : history.slice(0, 60),
      nextCursor: params.cursor ? null : "page-two",
    };
  if (method === "thread/turns/list")
    return {
      data: [
        {
          id: "turn",
          status: "completed",
          completedAt: completions.get(params.threadId),
        },
      ],
      nextCursor: null,
    };
  if (method === "thread/resume" || method === "thread/read") {
    const thread = history.find((t) => t.id === params.threadId);
    thread.updatedAt = 9999;
    return { thread: { ...thread }, cwd: thread.cwd };
  }
  if (method === "thread/items/list") return { data: [], nextCursor: null };
  return {};
};
app.set({
  current: null,
  threads: [],
  active: {},
  archived: false,
  search: "",
  projects: [],
  projectOrder: null,
});
await app.loadThreads();
assert.deepEqual(app.get().projectlessDirectories, projectlessDirectories);
assert.equal(app.get().threads.length, 60);
assert.equal(app.get().threads[0].id, "sort-64");
assert.equal(app.get().threadCursor, "60");
assert.deepEqual(app.get().projectOrder, [
  "/project-0",
  "/project-1",
  "/older-project",
  "",
]);
await app.loadThreads(true);
assert.equal(app.get().threads.length, 65);
assert.equal(app.get().threadCursor, null);
await app.openThread("sort-0");
assert.equal(app.get().current.completedAt, 200);
projectlessDirectories = {};
await app.loadThreads();
assert.deepEqual(app.get().projectlessDirectories, {});
projectlessUnavailable = true;
await app.loadThreads();
assert.deepEqual(app.get().projectlessDirectories, {});
assert.equal(app.get().threads[0].id, "sort-64");
assert.equal(app.get().threads.at(-1).id, "sort-0");
completions.set("sort-0", 500);
await act(async () =>
  socket.emit("turn/completed", {
    threadId: "sort-0",
    turn: { id: "new-turn", status: "completed", completedAt: 500 },
  }),
);
assert.equal(app.get().threads[0].id, "sort-0");
assert.equal(app.get().current.completedAt, 500);
assert.equal(
  (await app.listThreads({ archived: true, searchTerm: "排序" }))[0].id,
  "sort-0",
);
assert(
  requests.some(
    (r) =>
      r.method === "thread/list" &&
      r.params.archived &&
      r.params.searchTerm === "排序",
  ),
);
console.log(
  "PASS 完成时间全局排序、分页、打开旧对话顺序稳定、完成事件重排与搜索排序",
);

{
  const original = app.get();
  const previousResponse = responseFor;
  const threads = [
    { id: "stable-a-new", cwd: "/stable-a", completedAt: 100 },
    { id: "stable-b", cwd: "/stable-b", completedAt: 90 },
    { id: "stable-a-old", cwd: "/stable-a", completedAt: 10 },
  ].map((thread) => ({ ...thread, createdAt: 1, updatedAt: 1 }));
  const archived = new Set();
  responseFor = ({ method, params }) => {
    if (method === "lan/projectless/read") return { directories: {} };
    if (method === "thread/archive") archived.add(params.threadId);
    if (method === "thread/unarchive") archived.delete(params.threadId);
    if (method === "thread/list")
      return {
        data: threads.filter(
          (thread) => archived.has(thread.id) === params.archived,
        ),
      };
    if (method === "thread/turns/list")
      return {
        data: [
          {
            status: "completed",
            completedAt: threads.find((thread) => thread.id === params.threadId)
              .completedAt,
          },
        ],
      };
    if (method === "thread/resume" || method === "thread/read")
      return {
        thread: threads.find((thread) => thread.id === params.threadId),
      };
    if (method === "thread/items/list") return { data: [] };
    return {};
  };
  const paths = () => {
    const s = app.get();
    return projectGroups(
      s.threads,
      s.projects,
      s.pins,
      s.projectlessDirectories,
      s.projectlessRoot,
      s.projectOrder,
    ).map(([path]) => path);
  };
  try {
    app.set({
      current: null,
      threads: [],
      projects: [],
      projectOrder: null,
      pins: [],
      archived: false,
      search: "",
    });
    await app.loadThreads();
    const initial = ["/stable-a", "/stable-b", ""];
    assert.deepEqual(paths(), initial);
    await app.archive(threads[0]);
    assert.deepEqual(paths(), initial);
    await app.archive(threads[2]);
    assert.deepEqual(paths(), initial);
    assert(!app.get().threads.some((thread) => thread.cwd === "/stable-a"));
    let emptyProject;
    await act(async () => {
      emptyProject = create(
        React.createElement(app.ProjectGroup, { path: "/stable-a" }),
      );
    });
    await act(async () =>
      emptyProject.root
        .findByProps({ title: "在 stable-a 中新建对话" })
        .props.onClick(),
    );
    assert.equal(app.get().cwd, "/stable-a");
    assert.equal(app.get().current, null);
    await act(async () => emptyProject.unmount());
    app.set({ archived: true });
    await app.loadThreads();
    assert.deepEqual(paths(), initial);
    await app.archive(threads[0]);
    assert.equal(app.get().archived, false);
    assert.deepEqual(paths(), initial);
    app.addProject("/aaa-new");
    await app.loadThreads();
    assert.deepEqual(paths(), ["/aaa-new", ...initial]);
    threads[1].completedAt = 200;
    threads[1].updatedAt++;
    await act(async () =>
      socket.emit("turn/completed", {
        threadId: threads[1].id,
        turn: { id: "stable-turn", status: "completed", completedAt: 200 },
      }),
    );
    assert.equal(app.get().threads[0].id, "stable-b");
    assert.deepEqual(paths(), ["/aaa-new", ...initial]);
    threads.push({
      id: "stable-external",
      cwd: "/external-new",
      createdAt: 1,
      updatedAt: 1,
      completedAt: 5,
    });
    await app.loadThreads();
    assert.deepEqual(paths(), ["/external-new", "/aaa-new", ...initial]);
    app.set({ projectOrder: null });
    await app.loadThreads();
    assert.deepEqual(paths(), [
      "/stable-b",
      "/stable-a",
      "/external-new",
      "",
      "/aaa-new",
    ]);
    const beforeArchive = paths();
    for (const thread of threads.filter((thread) => !archived.has(thread.id)))
      await app.archive(thread);
    assert.equal(app.get().threads.length, 0);
    assert.deepEqual(paths(), beforeArchive);
    await app.loadThreads();
    assert.deepEqual(paths(), beforeArchive);
    app.set({ projectOrder: null });
    await app.loadThreads();
    assert.deepEqual(paths(), ["", "/aaa-new"]);
  } finally {
    app.set(original);
    responseFor = previousResponse;
  }
  console.log(
    "PASS 项目初始快照、全部归档保留空项目与新建入口、恢复保序、新增项目置前、重载重算",
  );
}

{
  responseFor = (m) =>
    m.method === "thread/list" ? { data: [], nextCursor: null } : {};
  const question = {
    id: "deployment",
    header: "部署方式",
    question: "希望怎样部署？",
    isOther: true,
    isSecret: false,
    options: [
      { label: "源码", description: "在本机构建。" },
      { label: "npm", description: "安装预构建包。" },
    ],
  };
  const request = {
    id: "input-fixture",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "questions",
      turnId: "question-turn",
      itemId: "question-item",
      isBlocking: true,
      autoResolutionMs: null,
      questions: [
        question,
        {
          id: "details",
          header: "补充说明",
          question: "还有哪些要求？",
          options: null,
        },
      ],
    },
  };
  const submitEvent = () => ({ preventDefault() {} });
  const showRequest = async (next = request, extra = {}) => {
    await act(async () => {
      app.set({
        connected: true,
        current: { id: "questions" },
        items: [],
        questions: [next],
        active: {},
        busy: false,
        error: "",
        ...extra,
      });
      view = create(React.createElement(app.Conversation));
    });
  };
  await showRequest(request, {
    questions: [
      request,
      {
        ...request,
        id: "other-thread",
        params: { ...request.params, threadId: "other" },
      },
    ],
  });
  assert.equal(view.root.findAllByType("form").length, 1);
  assert.equal(view.root.findByProps({ type: "submit" }).props.disabled, true);
  const firstGroup = view.root.findAllByType("fieldset")[0];
  await act(async () => firstGroup.findAllByType("input")[1].props.onChange());
  const details = view.root.findByType("textarea");
  await act(async () =>
    details.props.onChange({ target: { value: "第一行\n第二行" } }),
  );
  assert.equal(view.root.findByProps({ type: "submit" }).props.disabled, false);
  const form = view.root.findByType("form");
  const plainEnter = event({ target: { tagName: "TEXTAREA" } });
  await act(async () => form.props.onKeyDown(plainEnter));
  assert(!plainEnter.prevented);
  const composing = event({
    ctrlKey: true,
    nativeEvent: { isComposing: true },
  });
  await act(async () => form.props.onKeyDown(composing));
  assert(!requests.some((m) => m.id === request.id));
  await act(async () => form.props.onKeyDown(event({ ctrlKey: true })));
  assert.deepEqual(
    requests.find((m) => m.id === request.id),
    {
      id: request.id,
      result: {
        answers: {
          deployment: { answers: ["npm"] },
          details: { answers: ["第一行\n第二行"] },
        },
      },
    },
  );
  assert.equal(app.get().questions.length, 1);
  assert.equal(app.get().questions[0].id, "other-thread");
  await act(async () => assert.equal(app.respond(request, {}), false));
  assert.equal(requests.filter((m) => m.id === request.id).length, 1);
  await act(async () => view.unmount());
  console.log(
    "PASS 同步提问按对话显示、多问题校验、选项和多行回答、输入法与提交快捷键、重复提交保护",
  );

  const single = {
    ...request,
    params: { ...request.params, questions: [question], isBlocking: false },
  };
  await showRequest(single);
  assert.equal(view.root.findAllByType("input")[0].props.checked, true);
  await act(async () => view.root.findAllByType("input")[2].props.onChange());
  assert.equal(view.root.findByProps({ type: "submit" }).props.disabled, true);
  await act(async () =>
    view.root
      .findByType("textarea")
      .props.onChange({ target: { value: "容器\n部署" } }),
  );
  await act(async () => view.root.findAllByType("input")[1].props.onChange());
  assert.equal(view.root.findAllByType("textarea").length, 0);
  await act(async () => view.root.findAllByType("input")[2].props.onChange());
  assert.equal(view.root.findByType("textarea").props.value, "容器\n部署");
  await act(async () => app.set({ connected: false }));
  assert.equal(view.root.findByProps({ type: "submit" }).props.disabled, true);
  await act(async () => assert.equal(app.respond(single, {}), false));
  assert.equal(app.get().questions.length, 1);
  await act(async () => {
    app.set({ connected: true });
    socket.readyState = 3;
  });
  await act(async () =>
    view.root.findByType("form").props.onSubmit(submitEvent()),
  );
  assert.equal(app.get().questions.length, 1);
  assert.equal(view.root.findByType("textarea").props.value, "容器\n部署");
  assert(view.root.findByProps({ role: "alert" }));
  socket.readyState = 1;
  await act(async () =>
    view.root.findByType("form").props.onSubmit(submitEvent()),
  );
  assert.deepEqual(requests.findLast((m) => m.id === request.id).result, {
    answers: { deployment: { answers: ["容器\n部署"] } },
  });
  await act(async () => view.unmount());
  console.log("PASS 非阻塞提问预选、其他回答独立保存、断线保留回答及重试");

  await showRequest({
    ...single,
    params: {
      ...single.params,
      isBlocking: true,
      questions: [
        { ...question, isOther: false },
        {
          id: "secret",
          header: "私密信息",
          question: "请输入私密值",
          isSecret: true,
          options: null,
        },
      ],
    },
  });
  assert.equal(view.root.findAllByProps({ type: "radio" }).length, 2);
  assert.equal(
    view.root.findByProps({ type: "password" }).props.autoComplete,
    "off",
  );
  await act(async () => view.unmount());
  console.log("PASS 自定义回答开关和私密输入字段");

  await showRequest(single, {
    questions: [single, { ...single, id: "second-request" }],
  });
  const names = view.root
    .findAllByProps({ type: "radio" })
    .map((node) => node.props.name);
  assert.notEqual(names[0], names[3]);
  await act(async () =>
    socket.emit("item/tool/requestUserInput", single.params, 37),
  );
  await act(async () =>
    socket.emit("item/tool/requestUserInput", single.params, "37"),
  );
  assert.equal(
    app.get().questions.filter((question) => String(question.id) === "37")
      .length,
    1,
  );
  await act(async () =>
    socket.emit("serverRequest/resolved", { requestId: 37 }),
  );
  assert.equal(app.get().questions.length, 2);
  await act(async () =>
    socket.emit("lan/state", {
      ready: true,
      activeTurns: {},
      questions: [single],
      terminals: {},
    }),
  );
  assert.equal(view.root.findAllByType("form").length, 1);
  assert.equal(view.root.findAllByType("input")[0].props.checked, true);
  await act(async () =>
    socket.emit("serverRequest/resolved", {
      threadId: "questions",
      requestId: request.id,
    }),
  );
  assert.equal(app.get().questions.length, 0);
  await act(async () =>
    socket.emit("item/tool/requestUserInput", single.params, "second-request"),
  );
  await act(async () =>
    socket.emit("lan/questionResolved", { id: "second-request" }),
  );
  assert.equal(view.root.findAllByType("form").length, 0);
  await act(async () => view.unmount());
  console.log(
    "PASS 多张问题卡片的单选组隔离、请求 ID 去重、重连恢复、后端清理和跨页面解决通知",
  );

  const asyncItem = {
    id: "async-question",
    type: "agentMessage",
    turnId: "async-turn",
    phase: "commentary",
    text: "",
    questions: [
      { title: "选择运行方式", options: ["源码", "npm"] },
      { title: "补充部署要求", options: null },
    ],
  };
  await showRequest(single, {
    questions: [],
    items: [asyncItem],
    active: { questions: "async-turn" },
    draft: "尚未发送的草稿",
    attachments: [{ id: "draft-file" }],
  });
  assert.equal(view.root.findAllByType("form").length, 1);
  await act(async () =>
    socket.emit("item/completed", {
      threadId: "questions",
      turnId: "async-turn",
      item: {
        id: "continued",
        type: "agentMessage",
        phase: "commentary",
        text: "继续处理中",
      },
    }),
  );
  assert.equal(view.root.findAllByType("form").length, 1);
  await act(async () =>
    view.root
      .findByType("textarea")
      .props.onChange({ target: { value: "保留配置" } }),
  );
  responseFor = (m) => {
    if (m.method === "turn/steer")
      return { error: { code: -32000, message: "模拟发送失败" } };
    return m.method === "thread/list" ? { data: [], nextCursor: null } : {};
  };
  await act(async () =>
    view.root.findByType("form").props.onSubmit(submitEvent()),
  );
  assert(view.root.findByProps({ role: "alert" }));
  assert.equal(view.root.findByType("textarea").props.value, "保留配置");
  assert.equal(
    app.get().items.some((item) => item.optimistic),
    false,
  );
  responseFor = (m) =>
    m.method === "thread/list" ? { data: [], nextCursor: null } : {};
  await act(async () =>
    view.root.findByType("form").props.onSubmit(submitEvent()),
  );
  const steer = requests.findLast((m) => m.method === "turn/steer");
  assert.equal(steer.params.expectedTurnId, "async-turn");
  assert.equal(
    steer.params.input[0].text,
    "选择运行方式\n回答：源码\n\n补充部署要求\n回答：保留配置",
  );
  assert.equal(app.get().draft, "尚未发送的草稿");
  assert.deepEqual(app.get().attachments, [{ id: "draft-file" }]);
  assert.equal(view.root.findAllByType("form").length, 0);
  assert(!JSON.stringify(view.toJSON()).includes("回答已发送"));
  await act(async () =>
    view.root
      .findByProps({ className: "process-history" })
      .props.onToggle({ currentTarget: { open: true } }),
  );
  assert(JSON.stringify(view.toJSON()).includes("回答已发送"));
  await act(async () =>
    socket.emit("item/completed", {
      threadId: "questions",
      turnId: "async-turn",
      item: {
        id: "async-answer",
        type: "userMessage",
        content: steer.params.input,
      },
    }),
  );
  assert.equal(view.root.findAllByType("form").length, 0);
  assert(JSON.stringify(view.toJSON()).includes("选择运行方式"));
  await act(async () => view.unmount());
  console.log(
    "PASS 空正文异步提问展开、后续进度保留卡片、失败重试、运行中补充、草稿和附件保留、历史回显",
  );

  await showRequest(single, { questions: [], items: [asyncItem], active: {} });
  await act(async () =>
    view.root
      .findByType("textarea")
      .props.onChange({ target: { value: "全部结束后提交" } }),
  );
  await act(async () =>
    view.root.findByType("form").props.onSubmit(submitEvent()),
  );
  assert.equal(
    requests.findLast((m) => m.method === "turn/start").params.input[0].text,
    "选择运行方式\n回答：源码\n\n补充部署要求\n回答：全部结束后提交",
  );
  await act(async () => view.unmount());
  console.log("PASS 异步提问在轮次结束后通过新轮次提交回答");

  await showRequest(single, {
    questions: [],
    items: [
      asyncItem,
      {
        ...asyncItem,
        id: "another-async-question",
        questions: [{ title: "选择配置保留策略", options: ["保留", "覆盖"] }],
      },
    ],
    active: {},
  });
  assert.equal(view.root.findAllByType("form").length, 2);
  await act(async () =>
    socket.emit("item/completed", {
      threadId: "questions",
      turnId: "async-turn",
      item: {
        id: "unrelated-input",
        type: "userMessage",
        content: [{ type: "text", text: "请继续检查其他模块。" }],
      },
    }),
  );
  assert.equal(view.root.findAllByType("form").length, 2);
  await act(async () =>
    view.root.findByType("textarea").props.onChange({
      target: { value: "单独回答第一张卡片" },
    }),
  );
  await act(async () =>
    view.root.findAllByType("form")[0].props.onSubmit(submitEvent()),
  );
  const input = requests.findLast((message) => message.method === "turn/start")
    .params.input;
  await act(async () =>
    socket.emit("item/completed", {
      threadId: "questions",
      turnId: "async-turn",
      item: { id: "first-card-answer", type: "userMessage", content: input },
    }),
  );
  assert.equal(view.root.findAllByType("form").length, 1);
  assert(
    view.root
      .findByType("form")
      .findAllByType("p")
      .some((node) => node.props.children === "选择配置保留策略"),
  );
  await act(async () => view.unmount());
  await act(async () => {
    view = create(React.createElement(app.Conversation));
  });
  assert.equal(view.root.findAllByType("form").length, 1);
  await act(async () => view.unmount());
  console.log("PASS 多批异步提问独立回答，其他问题和普通补充消息保留待答卡片");
}
