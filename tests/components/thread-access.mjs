import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testThreadAccess(app, requests, setResponse, emit) {
  const original = app.get();
  const thread = { id: "writer-fixture", cwd: "/writer-test", createdAt: 1 };
  const conflict = { message: "thread fixture already has an active writer" };
  let finishResume;
  let locked = true;
  let readFails = false;
  let persistedInProgress = true;
  let view;
  const start = requests.length;
  const turnsSent = () =>
    requests
      .slice(start)
      .filter((request) =>
        ["turn/start", "turn/steer"].includes(request.method),
      ).length;
  const retryButton = () =>
    view.root.findByProps({ "aria-label": "重试连接对话" });
  const inputs = () => view.root.findAllByProps({ "aria-label": "消息" });
  const savedDraft = localStorage.getItem("cx-draft-new");
  setResponse(({ method }) => {
    if (method === "lan/projectless/read") return { directories: {} };
    if (method === "thread/read")
      return readFails ? { error: { message: "历史读取失败" } } : { thread };
    if (method === "thread/resume")
      return new Promise((resolve) => (finishResume = resolve));
    if (method === "thread/items/list")
      return {
        data: [
          {
            turnId: "saved-turn",
            item: {
              id: "saved-answer",
              type: "agentMessage",
              text: "已经保存的回答",
            },
          },
        ],
        nextCursor: null,
      };
    if (method === "thread/turns/list")
      return {
        data: persistedInProgress
          ? [{ id: "other-turn", status: "inProgress" }]
          : [],
      };
    if (method === "turn/start")
      return locked
        ? { error: conflict }
        : { turn: { id: "web-turn", status: "inProgress" } };
    if (method === "thread/list") return { data: [thread] };
    return { data: [] };
  });
  try {
    app.newChat(thread.cwd);
    app.set({ connected: true, threads: [], active: {}, serviceTier: null });
    localStorage.setItem("cx-draft-" + thread.id, "保留待发送内容");
    let opened;
    await act(async () => {
      opened = app.openThread(thread.id);
      view = create(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(app.Conversation),
          React.createElement(app.Composer),
        ),
      );
    });
    assert(finishResume);
    assert.equal(app.get().loading, false);
    assert.equal(app.get().current.id, thread.id);
    assert.equal(app.get().draft, "保留待发送内容");
    assert(JSON.stringify(view.toJSON()).includes("已经保存的回答"));
    assert(JSON.stringify(view.toJSON()).includes("正在检查对话状态"));
    assert.equal(inputs().length, 0);
    assert.equal(retryButton().props.disabled, true);
    assert.equal(await app.sendMessage(), false);
    assert.equal(turnsSent(), 0);
    assert.equal(requests[start].method, "thread/read");

    await act(async () => {
      finishResume({ error: conflict });
      await opened;
    });
    assert.equal(app.get().error, "");
    assert.equal(app.get().active[thread.id], undefined);
    assert.equal(app.get().serviceTier, null);
    assert(JSON.stringify(view.toJSON()).includes("此对话由另一端使用"));
    assert(!JSON.stringify(view.toJSON()).includes("正在查看已保存的记录"));
    assert(!JSON.stringify(view.toJSON()).includes("历史记录可"));
    assert(!JSON.stringify(view.toJSON()).includes("草稿和附件已保留"));
    assert.equal(inputs().length, 0);
    assert.equal(retryButton().props.disabled, false);
    assert.equal(await app.sendMessage(), false);
    assert.equal(turnsSent(), 0);

    const attachments = [
      {
        id: "fixture-image",
        name: "fixture.png",
        input: { type: "image", url: "data:image/png;base64,AQ==" },
      },
    ];
    await act(async () => app.set({ attachments }));
    let retried;
    const resumeCount = requests.filter(
      (request) => request.method === "thread/resume",
    ).length;
    await act(async () => {
      retried = retryButton().props.onClick();
    });
    assert.equal(retryButton().props.disabled, true);
    assert.equal(await app.refreshThreadAccess(), false);
    assert.equal(
      requests.filter((request) => request.method === "thread/resume").length,
      resumeCount + 1,
    );
    await act(async () => {
      finishResume({ error: conflict });
      await retried;
    });
    assert.equal(inputs().length, 0);
    assert.equal(app.get().draft, "保留待发送内容");
    assert.deepEqual(app.get().attachments, attachments);
    assert.equal(app.get().error, "");

    await act(async () => {
      retried = retryButton().props.onClick();
    });
    await act(async () => {
      finishResume({ error: { message: "模拟网络错误" } });
      await retried;
    });
    assert(JSON.stringify(view.toJSON()).includes("模拟网络错误"));
    assert.equal(inputs().length, 0);
    assert.equal(retryButton().props.disabled, false);
    await act(async () => {
      retried = retryButton().props.onClick();
    });
    await act(async () => {
      persistedInProgress = false;
      finishResume({ thread });
      await retried;
    });
    assert.equal(inputs().length, 1);
    assert.equal(inputs()[0].props.value, "保留待发送内容");
    assert.deepEqual(app.get().attachments, attachments);
    assert.equal(turnsSent(), 0);

    // 检查成功后，另一端仍可能在用户发送前取得写入权。
    await act(async () => assert.equal(await app.sendMessage(), false));
    assert.equal(turnsSent(), 1);
    assert.equal(inputs().length, 0);
    assert.equal(app.get().error, "");
    assert.equal(app.get().draft, "保留待发送内容");
    assert.equal(
      localStorage.getItem("cx-draft-" + thread.id),
      "保留待发送内容",
    );
    assert.deepEqual(app.get().attachments, attachments);
    assert.equal(app.get().items.filter((item) => item.optimistic).length, 0);
    locked = false;
    await act(async () => {
      retried = retryButton().props.onClick();
    });
    await act(async () => {
      finishResume({ thread });
      await retried;
    });
    assert.equal(turnsSent(), 1);
    await act(async () => assert.equal(await app.sendMessage(), true));
    assert.equal(app.get().draft, "");
    assert.deepEqual(app.get().attachments, []);
    assert.equal(app.get().active[thread.id], "web-turn");
    assert.equal(turnsSent(), 2);

    let refreshed;
    await act(async () => {
      refreshed = app.openThread(thread.id);
    });
    await act(async () => {
      app.set({
        model: "selected-model",
        effort: "ultra",
        serviceTier: "priority",
      });
      finishResume({
        thread,
        model: "saved-model",
        reasoningEffort: "low",
        serviceTier: null,
      });
      await refreshed;
    });
    assert.equal(app.get().model, "selected-model");
    assert.equal(app.get().effort, "ultra");
    assert.equal(app.get().serviceTier, "priority");

    await act(async () => {
      refreshed = app.openThread(thread.id);
    });
    await act(async () => {
      emit("turn/started", {
        threadId: thread.id,
        turn: { id: "new-live-turn", status: "inProgress" },
      });
      finishResume({ error: conflict });
      await refreshed;
    });
    assert.equal(app.get().active[thread.id], "new-live-turn");
    assert.equal(inputs().length, 1);

    readFails = true;
    await act(async () => app.openThread(thread.id));
    assert(JSON.stringify(view.toJSON()).includes("历史读取失败"));
    assert.equal(inputs().length, 0);
    readFails = false;
    await act(async () => {
      retried = retryButton().props.onClick();
    });
    await act(async () => {
      finishResume({ thread });
      await retried;
    });
    assert.equal(inputs().length, 1);

    let stale;
    await act(async () => {
      stale = app.refreshThreadAccess();
    });
    await act(async () => {
      app.newChat("/other");
      app.setDraft("新对话草稿");
      finishResume({ error: conflict });
      await stale;
    });
    assert.equal(app.get().current, null);
    assert.equal(app.get().threadAccess, null);
    assert.equal(app.get().draft, "新对话草稿");
    assert.equal(inputs().length, 1);
    console.log(
      "PASS 进入对话即检查所有权、占用区替代发送框、重试及防重复、草稿附件保留与迟到响应隔离",
    );
  } finally {
    await act(async () => {
      view?.unmount();
      app.newChat();
      app.set(original);
    });
    localStorage.removeItem("cx-draft-" + thread.id);
    if (savedDraft === null) localStorage.removeItem("cx-draft-new");
    else localStorage.setItem("cx-draft-new", savedDraft);
  }
}
