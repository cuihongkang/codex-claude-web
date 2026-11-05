import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testCompaction(app, requests, setResponse, emit) {
  const original = app.get();
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  document.visibilityState = "visible";
  const thread = { id: "compact-fixture", cwd: "/compact-fixture" };
  const attachment = {
    id: "compact-attachment",
    name: "note.txt",
    input: { type: "text", text: "附件内容" },
  };
  let view,
    acknowledge,
    acknowledgeSend,
    holdSend = false,
    failSend = false,
    fail = false;
  const response = ({ method }) => {
    if (method === "thread/compact/start") {
      assert.equal(
        JSON.parse(localStorage.getItem("cx-compactions"))[thread.id]?.status,
        "starting",
        "请求发出前保存恢复记录，覆盖提交响应前刷新",
      );
      return fail
        ? { error: { message: "模拟整理失败" } }
        : new Promise((resolve) => (acknowledge = resolve));
    }
    if (method === "thread/list" || method === "skills/list")
      return { data: [] };
    if (method === "turn/start") {
      if (holdSend)
        return new Promise((resolve) => (acknowledgeSend = resolve));
      return failSend
        ? { error: { message: "模拟发送失败" } }
        : { turn: { id: "after-compact", status: "completed" } };
    }
    return {};
  };
  const text = () => JSON.stringify(view.toJSON());
  const send = () => view.root.findByProps({ "aria-label": "发送消息" });
  const closeView = async () => {
    await act(async () => view.unmount());
    view = null;
  };
  const snapshot = (compaction) =>
    emit("lan/compaction", { threadId: thread.id, compaction });
  const turnStart = (id) =>
    emit("turn/started", {
      threadId: thread.id,
      turn: { id, status: "inProgress" },
    });
  const turnEnd = (id, status = "completed") =>
    emit("turn/completed", {
      threadId: thread.id,
      turn: {
        id,
        status,
        error: status === "failed" ? { message: "后端整理失败" } : null,
      },
    });
  const writesSince = (at) =>
    requests
      .slice(at)
      .filter((r) =>
        [
          "turn/start",
          "turn/steer",
          "thread/compact/start",
          "review/start",
        ].includes(r.method),
      );
  try {
    setResponse(response);
    app.set({
      ...original,
      connected: true,
      current: thread,
      cwd: thread.cwd,
      active: {},
      compactions: {},
      threadAccess: null,
      busy: false,
      loading: false,
      items: [],
      attachments: [attachment],
    });
    await act(async () => {
      view = create(React.createElement(app.Composer));
    });
    let command;
    await act(async () => {
      app.setDraft("/compact");
      command = app.runComposerCommand("/compact");
    });
    assert(text().includes("正在提交上下文整理"));
    assert.equal(view.root.findAllByType("p").length, 0);
    assert(!text().includes("草稿和附件已保留"));
    assert.equal(send().props.disabled, true);
    const at = requests.length;
    await act(async () => {
      app.setDraft("整理期间保留的草稿");
      assert.equal(await app.sendMessage(), false);
      await app.submitComposer();
    });
    assert.equal(writesSince(at).length, 0);
    assert.equal(app.get().draft, "整理期间保留的草稿");
    assert.deepEqual(app.get().attachments, [attachment]);
    await assert.rejects(app.compact(), /正在整理上下文/);
    await assert.rejects(app.review(), /正在整理上下文/);
    await act(async () => {
      acknowledge({});
      await command;
    });
    assert.equal(send().props.disabled, true, "请求确认后仍暂停发送");
    assert.equal(app.get().draft, "整理期间保留的草稿");
    await act(async () => {
      snapshot({
        ...app.get().compactions[thread.id],
        id: "bridge-1",
        status: "running",
        turnId: "compact-turn",
      });
      turnStart("compact-turn");
      emit("item/started", {
        threadId: thread.id,
        turnId: "compact-turn",
        item: { id: "compact-item", type: "contextCompaction" },
      });
    });
    assert(text().includes("正在整理上下文"));
    assert.equal(
      app.get().items.find((item) => item.id === "compact-item").status,
      "inProgress",
    );
    await act(async () =>
      emit("item/completed", {
        threadId: thread.id,
        turnId: "compact-turn",
        item: { id: "compact-item", type: "contextCompaction" },
      }),
    );
    assert.equal(send().props.disabled, true, "整理记录完成后等待轮次结束");
    assert.equal(
      JSON.parse(localStorage.getItem("cx-compactions"))[thread.id].turnId,
      "compact-turn",
      "保留所属轮次以供完整刷新后核对",
    );
    assert.equal(
      app.get().items.find((item) => item.id === "compact-item").status,
      "completed",
    );
    await act(async () => turnEnd("old-turn"));
    assert.equal(send().props.disabled, true, "旧轮次结束保持当前整理占用");
    await act(async () => {
      turnEnd("compact-turn");
      emit("thread/tokenUsage/updated", {
        threadId: thread.id,
        tokenUsage: { last: { totalTokens: 2000 }, modelContextWindow: 100000 },
      });
    });
    assert(text().includes("上下文整理完成"));
    assert.deepEqual(
      JSON.parse(localStorage.getItem("cx-compactions")),
      {},
      "整理结束后清理恢复记录",
    );
    assert(text().includes("2,000"));
    assert.equal(send().props.disabled, false);
    assert.equal(app.get().draft, "整理期间保留的草稿");
    assert.deepEqual(app.get().attachments, [attachment]);
    await closeView();
    await act(async () => {
      view = create(React.createElement(app.Composer));
    });
    assert(text().includes("上下文整理完成"), "重新打开组件仍保留完成结果");
    await act(async () =>
      app.set({ current: { id: "other-compact-chat", cwd: "/other" } }),
    );
    assert(!text().includes("上下文整理完成"));
    assert.equal(send().props.disabled, false);
    await act(async () => app.set({ current: thread }));
    assert(!text().includes("上下文整理完成"), "切换回来保持完成提示关闭");
    await act(async () =>
      snapshot({
        id: "bridge-1",
        status: "completed",
        turnId: "compact-turn",
      }),
    );
    assert(!text().includes("上下文整理完成"), "重复结果通知保持提示关闭");

    fail = true;
    await act(async () => app.setDraft("/compact"));
    await act(async () => app.submitComposer());
    assert(
      text().includes("上下文整理失败") && text().includes("模拟整理失败"),
    );
    assert.equal(app.get().draft, "/compact");
    assert.deepEqual(app.get().attachments, [attachment]);
    fail = false;
    let retried;
    await act(async () => {
      retried = app.compact();
    });
    await act(async () => {
      turnStart("retry-turn");
      turnEnd("retry-turn");
      acknowledge({});
      await retried;
    });
    assert(text().includes("上下文整理完成"), "迟到确认保留已完成状态");
    for (const status of ["failed", "interrupted"]) {
      await act(async () => {
        snapshot({
          id: status,
          startedAt: Date.now() / 1000,
          status: "running",
          turnId: status,
        });
        turnStart(status);
        turnEnd(status, status);
      });
      assert(
        text().includes(
          status === "failed" ? "后端整理失败" : "上下文整理已中断",
        ),
      );
      assert.equal(send().props.disabled, false);
    }
    await act(async () =>
      snapshot({
        id: "reconnecting",
        status: "reconnecting",
        startedAt: Date.now() / 1000,
        error: "连接中断，正在确认",
      }),
    );
    assert(text().includes("正在确认整理状态"));
    assert.equal(send().props.disabled, true);
    await act(async () =>
      snapshot({
        id: "reconnecting",
        status: "completed",
        startedAt: 1,
        completedAt: 3,
      }),
    );
    assert.equal(send().props.disabled, false);
    const beforeSend = requests.length;
    const completed = app.get().compactions[thread.id];
    const otherId = "other-compact-chat";
    await act(async () => {
      app.set({
        compactions: { ...app.get().compactions, [otherId]: completed },
      });
      assert.equal(await app.sendMessage("", []), false);
    });
    assert(text().includes("上下文整理完成"), "空消息保留完成提示");
    holdSend = true;
    let sending;
    await act(async () => {
      app.setDraft("整理结束后的消息");
      sending = app.sendMessage();
    });
    assert(!text().includes("上下文整理完成"), "发送等待期间立即关闭完成提示");
    assert.equal(app.get().compactions[thread.id], undefined);
    assert.equal(app.get().compactions[otherId], completed, "保留其他对话提示");
    await act(async () => {
      app.set({ current: { id: otherId } });
      acknowledgeSend({ turn: { id: "after-compact", status: "completed" } });
      await sending;
    });
    assert(text().includes("上下文整理完成"), "迟到发送响应保留当前对话提示");
    await act(async () => app.set({ current: thread, draft: "" }));
    assert(!text().includes("上下文整理完成"), "返回原对话后完成提示保持关闭");
    assert.equal(writesSince(beforeSend).length, 1);
    assert.equal(app.get().draft, "");
    holdSend = false;
    failSend = true;
    await act(async () => {
      app.set({
        compactions: { ...app.get().compactions, [thread.id]: completed },
      });
      app.setDraft("发送失败后重试的消息");
      assert.equal(await app.sendMessage(), false);
    });
    assert(!text().includes("上下文整理完成"));
    assert.equal(app.get().draft, "发送失败后重试的消息");
    assert.deepEqual(app.get().attachments, [attachment]);
    failSend = false;
    await act(async () => assert.equal(await app.sendMessage(), true));
    assert.equal(app.get().draft, "");
    let late;
    await act(async () => {
      app.set({ error: "" });
      app.setDraft("/compact");
      late = app.runComposerCommand("/compact");
    });
    await act(async () => {
      app.set({ current: { id: "different-chat", cwd: "/different" } });
      app.setDraft("另一对话的新草稿");
      acknowledge({ error: { message: "旧整理提交失败" } });
      await late;
    });
    assert.equal(app.get().draft, "另一对话的新草稿");
    assert.equal(app.get().error, "");
    assert.equal(localStorage.getItem("cx-draft-" + thread.id), "/compact");
    console.log(
      "PASS 上下文整理确认与完成分离、发送及审查占用、草稿附件保留、真实结果与失败重试、迟到确认、切换对话和状态恢复",
    );
  } finally {
    if (view) await closeView();
    app.set(original);
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
}
