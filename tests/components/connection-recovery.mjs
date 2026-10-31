import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testConnectionRecovery(app, requests, setResponse, emit) {
  const original = app.get();
  const thread = { id: "recovery-fixture", cwd: "/recovery", createdAt: 1 };
  const turnId = "recovery-turn";
  const answer = (text) => ({
    id: "recovery-answer",
    type: "agentMessage",
    phase: "final_answer",
    text,
    turnId,
  });
  const process = {
    id: "recovery-command",
    type: "commandExecution",
    command: "pwd",
    status: "inProgress",
    turnId,
  };
  let finishHistory;
  let finishResume;
  let view;
  const state = (ready) => ({
    ready,
    defaultCwd: thread.cwd,
    questions: [],
    activeTurns: { [thread.id]: turnId },
    terminals: {},
  });
  setResponse(({ method }) => {
    if (method === "model/list") return { data: [] };
    if (method === "config/read") return { config: {} };
    if (method === "account/read") return { account: null };
    if (method === "thread/list") return { data: [thread] };
    if (method === "lan/projectless/read") return { directories: {} };
    if (method === "thread/read") return { thread };
    if (method === "thread/resume")
      return new Promise((resolve) => (finishResume = resolve));
    if (method === "thread/items/list")
      return new Promise((resolve) => (finishHistory = resolve));
    if (method === "thread/turns/list")
      return { data: [{ id: turnId, status: "inProgress" }] };
    return { data: [] };
  });
  const recover = async () => {
    finishHistory = finishResume = null;
    await act(async () => {
      await emit("lan/state", state(false));
      await emit("lan/state", state(true));
    });
    assert(finishHistory);
    assert(finishResume);
  };
  const history = (text) => ({
    data: [process, answer(text)].reverse().map((item) => ({ item, turnId })),
    nextCursor: null,
  });
  try {
    app.newChat(thread.cwd);
    app.set({
      connected: true,
      current: thread,
      items: [process, answer("断线前的部分回答")],
      threadAccess: { threadId: thread.id, status: "ready" },
      active: { [thread.id]: turnId },
      questions: [],
      model: "selected-model",
      effort: "high",
      serviceTier: null,
      panel: "files",
      contextOpen: true,
      attachments: [{ id: "recovery-attachment", name: "notes.txt" }],
    });
    app.setDraft("重连前的草稿");
    await act(async () => {
      view = create(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(app.Conversation),
          React.createElement(app.Composer),
        ),
      );
    });
    await act(async () => {
      view.root
        .findByProps({ className: "process-history" })
        .props.onToggle({ currentTarget: { open: true } });
    });
    const input = view.root.findByProps({ "aria-label": "消息" });
    const processContent = view.root.findByProps({
      className: "process-content",
    });
    const start = requests.length;
    await recover();
    assert.equal(app.get().loading, false);
    assert.equal(app.get().items.at(-1).text, "断线前的部分回答");
    assert.equal(view.root.findByProps({ "aria-label": "消息" }), input);
    assert.equal(
      view.root.findByProps({ className: "process-content" }),
      processContent,
      "重连检查期间保留已展开的工作过程",
    );
    assert.equal(
      view.root.findByProps({ "aria-label": "发送消息" }).props.disabled,
      true,
    );
    assert.equal(await app.sendMessage(), false);
    assert.equal(app.get().panel, "files");
    assert.equal(app.get().attachments[0].name, "notes.txt");
    assert.equal(
      requests.slice(start).filter((r) => r.method === "thread/read").length,
      0,
      "已有对话重连直接同步历史，保持当前视图",
    );
    await act(async () => {
      app.setDraft("同步历史时继续编辑草稿");
      finishHistory(history("断线期间补齐的完整回答"));
      finishResume({ thread, model: "selected-model" });
    });
    assert.equal(app.get().items.at(-1).text, "断线期间补齐的完整回答");
    assert.equal(app.get().draft, "同步历史时继续编辑草稿");
    assert.equal(app.get().effort, "");
    assert.equal(app.get().serviceTier, null);
    assert.equal(app.get().threadAccess.status, "ready");
    assert.equal(view.root.findByProps({ "aria-label": "消息" }), input);
    assert.equal(
      view.root.findByProps({ className: "process-content" }),
      processContent,
    );

    await recover();
    await act(async () => {
      await emit("item/completed", {
        threadId: thread.id,
        turnId,
        item: answer("读取期间收到的最新回答"),
      });
      finishHistory(history("较早的历史快照"));
      finishResume({ thread });
    });
    assert.equal(app.get().items.at(-1).text, "读取期间收到的最新回答");

    await recover();
    const oldHistory = finishHistory;
    const oldResume = finishResume;
    await recover();
    await act(async () => {
      oldHistory(history("上一个连接恢复任务的迟到结果"));
      oldResume({ error: { message: "迟到的写入占用" } });
    });
    assert.equal(app.get().items.at(-1).text, "读取期间收到的最新回答");
    assert.equal(app.get().threadAccess.status, "checking");
    await act(async () => {
      finishHistory({ error: { message: "模拟历史同步失败" } });
      finishResume({ thread });
    });
    assert.equal(app.get().items.at(-1).text, "读取期间收到的最新回答");
    assert.match(app.get().error, /模拟历史同步失败/);
    assert.equal(view.root.findByProps({ "aria-label": "消息" }), input);

    await recover();
    await act(async () => {
      app.newChat("/another-project");
      app.setDraft("新对话的草稿");
      finishHistory(history("切换前对话的迟到历史"));
      finishResume({ error: { message: "切换前的写入占用" } });
    });
    assert.equal(app.get().current, null);
    assert.equal(app.get().draft, "新对话的草稿");
    assert.equal(app.get().threadAccess, null);
    assert.deepEqual(app.get().items, []);
  } finally {
    await act(async () => {
      view?.unmount();
      app.newChat();
      app.set(original);
    });
    localStorage.removeItem("cx-draft-" + thread.id);
  }
  console.log(
    "PASS 重连保留消息与组件状态、草稿附件、历史补齐、实时更新优先及失败与迟到结果隔离",
  );
}
