import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testContextPanel(app, requests, setResponse, emit) {
  const original = app.get();
  const previousWindow = globalThis.window;
  const mediaListeners = new Set();
  const media = {
    matches: true,
    addEventListener: (name, listener) => mediaListeners.add(listener),
    removeEventListener: (name, listener) => mediaListeners.delete(listener),
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    confirm: () => false,
    matchMedia: () => media,
  };
  const parent = {
    id: "context-parent-fixture",
    cwd: "/fixture/parent",
    name: "父任务",
  };
  const activity = (id, kind = "started") => ({
    id: "event-" + id + kind,
    type: "subAgentActivity",
    agentThreadId: id,
    agentPath: "/root/" + id,
    kind,
    turnId: "parent-turn",
  });
  const parentItems = [
    activity("agent-a"),
    activity("agent-a", "interacted"),
    activity("agent-b"),
  ];
  const record = (id, type, text, phase) => ({
    turnId: "child-turn",
    item: {
      id,
      type,
      text,
      phase,
      ...(type === "userMessage" ? { content: [{ type: "text", text }] } : {}),
    },
  });
  let fail = false;
  let legacy = false;
  let hold = false;
  let release;
  let view;
  let incoming = [
    {
      id: "parent-task",
      type: "userMessage",
      authorLabel: "主代理",
      turnId: "child-turn",
      beforeItemId: "task",
      content: [{ type: "text", text: "主代理交付的检查要求" }],
    },
  ];
  setResponse(({ method, params }) => {
    if (method === "lan/agents/messages")
      return { messages: params.threadId === "agent-a" ? incoming : [] };
    if (method === "fs/readDirectory") return { entries: [] };
    if (method === "fs/readFile")
      return { dataBase64: Buffer.from("文件原始内容").toString("base64") };
    if (method === "process/exec")
      return { stdout: "", stderr: "", exitCode: 0 };
    if (method === "thread/read")
      return {
        thread: {
          id: params.threadId,
          cwd: "/fixture/child",
          model: "child-model",
        },
      };
    if (method === "thread/turns/list")
      return {
        data: [
          {
            id: "child-turn",
            status: "inProgress",
            ...(params.itemsView === "full" && {
              items: [record("b-task", "userMessage", "旧格式子代理历史").item],
            }),
          },
        ],
      };
    if (method === "thread/items/list") {
      if (fail) return { error: { message: "模拟子代理读取失败" } };
      if (legacy)
        return {
          error: { message: "thread/items/list is not supported yet" },
        };
      if (params.threadId === "agent-b")
        return { data: [record("b-task", "userMessage", "第二个子代理任务")] };
      if (!params.cursor)
        return {
          data: [
            record("task", "userMessage", "检查子代理分页任务"),
            record("stream", "agentMessage", "历史前缀", "final_answer"),
          ],
          nextCursor: "second",
        };
      const page = {
        data: [record("answer", "agentMessage", "分页结果", "final_answer")],
      };
      return hold
        ? new Promise((resolve) => {
            release = () => resolve(page);
          })
        : page;
    }
    if (method === "thread/list") return { data: [parent] };
    return { data: [] };
  });
  const text = () => JSON.stringify(view.toJSON());
  const nodeText = (node) =>
    typeof node === "string"
      ? node
      : node.children?.map(nodeText).join("") || "";
  const click = async (label, root = view.root) =>
    act(async () => {
      const button = root
        .findAllByType("button")
        .find(
          (node) =>
            nodeText(node) === label ||
            node.props.title === label ||
            node.findAllByType("span").some((span) => nodeText(span) === label),
        );
      assert(button, label);
      button.props.onClick();
    });
  const openAgent = (id) => click("/root/" + id);
  const tools = () => view.root.findByProps({ className: "context-tools" });
  const toggle = () =>
    tools()
      .findAllByType("button")
      .find((node) => node.props["aria-controls"] === "conversation-context");
  const firstRequest = requests.length;
  try {
    await act(async () => {
      app.set({
        current: parent,
        cwd: parent.cwd,
        connected: true,
        items: parentItems,
        draft: "父对话草稿",
        attachments: [{ id: "parent-attachment" }],
        panel: null,
        contextOpen: null,
        active: {},
        turns: {},
        questions: [],
      });
      view = create(React.createElement(app.ContextWorkspace));
    });
    assert.equal(
      toggle().props["aria-expanded"],
      false,
      "桌面初次打开默认折叠",
    );
    assert.equal(
      view.root.findByProps({ "aria-label": "对话详情" }).props["data-open"],
      false,
    );
    await click("展开对话详情", tools());
    assert.equal(
      view.root.findAllByProps({ title: "/root/agent-a" }).length,
      1,
    );
    assert(text().includes("工作区") && text().includes("子代理"));
    assert.deepEqual(
      tools()
        .findAllByType("button")
        .map((node) => node.props.title),
      ["文件", "变更", "终端", "折叠对话详情"],
    );
    assert.equal(toggle().props["aria-expanded"], true);
    await click("折叠对话详情");
    assert.equal(app.get().contextOpen, false);
    assert.deepEqual(
      tools()
        .findAllByType("button")
        .map((node) => node.props.title),
      ["文件", "变更", "终端", "展开对话详情"],
    );
    await click("终端", tools());
    assert.equal(app.get().terminalOpen, !original.terminalOpen);
    assert.equal(app.get().contextOpen, false);
    await click("终端", tools());
    await click("文件", tools());
    assert.equal(app.get().panel, "files");
    assert.equal(app.get().contextOpen, true);
    assert.equal(
      tools()
        .findAllByProps({ title: "文件" })
        .find((node) => node.type === "button").props["aria-pressed"],
      true,
    );
    await act(async () => app.set({ panelFile: "/fixture/parent/report.txt" }));
    const editor = view.root.findByProps({ "aria-label": "文件源码" });
    await act(async () =>
      editor.props.onChange({ target: { value: "文件未保存内容" } }),
    );
    await click("文件", tools());
    assert.equal(app.get().contextOpen, false);
    assert.equal(app.get().panel, null);
    assert.equal(app.get().panelAgent, null);
    assert.equal(toggle().props["aria-expanded"], false);
    assert.equal(
      tools().findAllByType("button")[0].props["aria-pressed"],
      false,
    );
    await click("文件", tools());
    assert.equal(app.get().contextOpen, true);
    assert.equal(app.get().panel, "files");
    assert.equal(
      view.root.findByProps({ "aria-label": "文件源码" }).props.value,
      "文件未保存内容",
    );
    await click("变更", tools());
    assert.equal(app.get().panel, "changes");
    assert.equal(tools().findAllByType("button").length, 4);
    assert.equal(
      tools().findAllByType("button")[1].props["aria-pressed"],
      true,
    );
    await click("变更", tools());
    assert.equal(app.get().contextOpen, false);
    assert.equal(app.get().panel, null);
    assert.equal(toggle().props["aria-expanded"], false);
    assert.equal(
      tools().findAllByType("button")[1].props["aria-pressed"],
      false,
    );
    await click("展开对话详情", tools());
    assert.equal(app.get().panel, null);
    assert(view.root.findByProps({ className: "context-card" }));
    await click("变更", tools());
    assert.equal(app.get().contextOpen, true);
    assert.equal(app.get().panel, "changes");
    await click("文件", tools());
    assert.equal(app.get().panel, "files");
    assert.equal(
      view.root.findByProps({ "aria-label": "文件源码" }).props.value,
      "文件未保存内容",
    );
    await click("收起对话详情");
    assert.equal(app.get().panel, null);
    assert.equal(app.get().panelAgent, null);
    await click("展开对话详情");
    assert.equal(app.get().contextOpen, true);
    assert.equal(app.get().panel, null);
    assert(view.root.findByProps({ className: "context-card" }));
    assert.equal(
      view.root.findByProps({ "aria-label": "文件源码" }).props.value,
      "文件未保存内容",
    );
    await click("折叠对话详情");
    await click("变更", tools());
    assert.equal(app.get().panel, "changes");
    await click("收起对话详情");
    await click("展开对话详情");
    assert.equal(app.get().panel, null);
    await click("终端");
    assert.equal(app.get().terminalOpen, !original.terminalOpen);
    await click("变更");
    assert.equal(app.get().panel, "changes");
    await click("返回概览");
    await openAgent("agent-a");
    assert(
      text().includes("检查子代理分页任务") && text().includes("分页结果"),
    );
    assert(text().includes("child-model"));
    assert(text().includes("主代理交付的检查要求"));
    await act(async () => {
      incoming = [
        ...incoming,
        {
          id: "parent-followup",
          type: "userMessage",
          authorLabel: "主代理",
          content: [{ type: "text", text: "主代理后续补充要求" }],
        },
      ];
      emit("item/completed", {
        threadId: parent.id,
        turnId: "parent-turn",
        item: activity("agent-a", "interacted"),
      });
    });
    assert(text().includes("主代理后续补充要求"));
    assert.equal(app.get().current.id, parent.id);
    assert.equal(app.get().draft, "父对话草稿");
    assert.equal(app.get().attachments[0].id, "parent-attachment");
    assert.deepEqual(app.get().items, parentItems);
    assert.equal(
      view.root.findAllByProps({ title: "编辑并重新发送" }).length,
      0,
    );
    assert.equal(view.root.findAllByProps({ title: "添加批注" }).length, 0);
    assert(
      requests
        .slice(firstRequest)
        .some(
          (request) =>
            request.method === "thread/items/list" &&
            request.params.cursor === "second",
        ),
    );
    assert(
      !requests
        .slice(firstRequest)
        .some((request) =>
          ["thread/resume", "turn/start", "turn/steer"].includes(
            request.method,
          ),
        ),
    );
    await act(async () =>
      emit("item/agentMessage/delta", {
        threadId: "agent-a",
        turnId: "child-turn",
        itemId: "stream",
        delta: "实时追加",
      }),
    );
    assert(text().includes("历史前缀实时追加"));
    assert.deepEqual(app.get().items, parentItems);
    await act(async () =>
      emit("item/agentMessage/delta", {
        threadId: "agent-b",
        turnId: "child-turn",
        itemId: "stream",
        delta: "其他代理消息",
      }),
    );
    assert(!text().includes("其他代理消息"));

    hold = true;
    await click("刷新子代理对话");
    assert(release);
    await act(async () => {
      emit("item/agentMessage/delta", {
        threadId: "agent-a",
        turnId: "child-turn",
        itemId: "stream",
        delta: "读取期间新增",
      });
      release();
    });
    assert(text().includes("历史前缀读取期间新增"));
    await click("刷新子代理对话");
    await act(async () =>
      app.openSubAgent({
        id: "agent-b",
        path: "/root/agent-b",
        name: "agent-b",
      }),
    );
    assert(text().includes("第二个子代理任务"));
    assert(!text().includes("主代理交付的检查要求"));
    await act(async () => release());
    assert(!text().includes("分页结果"));
    fail = true;
    await click("刷新子代理对话");
    assert(text().includes("模拟子代理读取失败"));
    fail = false;
    await click("重试读取");
    assert(!text().includes("模拟子代理读取失败"));
    await act(async () => app.set({ connected: false }));
    assert(text().includes("连接恢复后自动更新"));
    await act(async () => app.set({ connected: true }));
    assert(text().includes("第二个子代理任务"));
    legacy = true;
    await click("刷新子代理对话");
    assert(text().includes("旧格式子代理历史"));
    assert(!text().includes("thread/items/list is not supported yet"));
    legacy = false;
    await click("收起对话详情");
    assert.equal(app.get().panel, null);
    assert.equal(app.get().panelAgent, null);
    assert(!text().includes("第二个子代理任务"));
    await act(async () =>
      emit("item/agentMessage/delta", {
        threadId: "agent-b",
        turnId: "child-turn",
        itemId: "stream",
        delta: "详情关闭后的迟到消息",
      }),
    );
    await click("展开对话详情");
    assert.equal(app.get().panel, null);
    assert(!text().includes("详情关闭后的迟到消息"));
    await openAgent("agent-b");
    assert(text().includes("第二个子代理任务"));
    await act(async () =>
      app.set({ current: { id: "other-parent" }, items: [] }),
    );
    assert.equal(app.get().panel, null);
    assert(!text().includes("第二个子代理任务"));
    assert(!text().includes("子代理"));
    await act(async () => app.set({ contextOpen: null }));
    assert.equal(tools().props["data-open"], false);
    await act(async () => {
      media.matches = false;
      for (const listener of mediaListeners) listener();
    });
    assert.equal(tools().props["data-open"], false);
    assert.equal(toggle().props.title, "展开对话详情");
    await click("展开对话详情", tools());
    await act(async () => {
      media.matches = true;
      for (const listener of mediaListeners) listener();
    });
    assert.equal(tools().props["data-open"], true);
    await act(async () => app.set({ contextOpen: null }));
    assert.equal(toggle().props["aria-expanded"], false);
    await act(async () => app.set({ current: parent, cwd: parent.cwd }));
    await click("文件", tools());
    assert.equal(
      view.root.findByProps({ "aria-label": "文件源码" }).props.value,
      "文件未保存内容",
    );
    await act(async () => app.newChat(undefined, { reuseDirectory: true }));
    assert.equal(app.get().current, null);
    assert.equal(app.get().contextOpen, false);
    assert.equal(app.get().panel, null);
    assert.equal(app.get().panelFile, null);
    assert.equal(app.get().panelAgent, null);
    await click("展开对话详情", tools());
    assert(view.root.findByProps({ className: "context-card" }));
    await click("文件", tools());
    assert.equal(
      view.root.findAllByProps({ "aria-label": "文件源码" }).length,
      0,
    );
    assert.equal(
      view.root.findAllByProps({ className: "file-diff-view" }).length,
      0,
    );
    hold = false;
    await act(async () => app.openThread(parent.id));
    assert.equal(app.get().contextOpen, false);
    await click("文件", tools());
    assert.equal(
      view.root.findByProps({ "aria-label": "文件源码" }).props.value,
      "文件未保存内容",
      "回到原对话继续编辑未保存文件",
    );
    for (const panel of ["files", "changes", "agent"]) {
      await act(async () => {
        app.set({ panel, panelAgent: { id: "agent-a", parentId: parent.id } });
        app.set({ panelFile: "/fixture/pending.txt" });
        app.newChat(parent.cwd);
      });
      assert.equal(app.get().contextOpen, false, panel);
      assert.equal(app.get().panel, null, panel);
      assert.equal(app.get().panelFile, null, panel);
      assert.equal(app.get().panelAgent, null, panel);
    }
  } finally {
    await act(async () => view?.unmount());
    assert.equal(mediaListeners.size, 0);
    app.set(original);
    globalThis.window = previousWindow;
  }
  console.log(
    "PASS 工作区默认折叠、常驻四按钮工具栏、显式展开与响应式布局、文件和变更重复点击折叠、详情直接切换和文件草稿保留、子代理只读分页与事件隔离、关闭后回概览、失败重试及重连",
  );
}
