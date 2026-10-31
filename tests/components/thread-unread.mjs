import assert from "node:assert/strict";

export async function testThreadUnread(app, setResponse, emit) {
  const original = app.get();
  const thread = {
    id: "unread-fixture",
    cwd: "/unread-test",
    createdAt: 1,
    completedAt: 100,
  };
  const finish = (id, status = "completed") =>
    emit("turn/completed", {
      threadId: thread.id,
      turn: { id, status, completedAt: 200 },
    });
  const start = (id) =>
    emit("turn/started", {
      threadId: thread.id,
      turn: { id, status: "inProgress", startedAt: 150 },
    });
  setResponse(({ method }) =>
    method === "thread/list" ? { data: [thread] } : { data: [] },
  );
  try {
    app.setReadingThread(null);
    app.set({
      connected: true,
      current: null,
      threads: [thread],
      active: {},
      unreadCompletions: {},
      loading: false,
      threadAccess: null,
    });
    await app.loadThreads();
    assert.deepEqual(app.get().unreadCompletions, {}, "历史列表保留无提示状态");
    await finish("unobserved");
    assert.deepEqual(
      app.get().unreadCompletions,
      {},
      "未观察到运行的结束通知保持无提示",
    );

    await start("first");
    await finish("older");
    assert.equal(app.get().active[thread.id], "first");
    assert.deepEqual(
      app.get().unreadCompletions,
      {},
      "旧轮次通知保留新轮次状态",
    );
    await finish("first");
    assert.equal(app.get().unreadCompletions[thread.id], "first");

    app.set({
      provider: "claude",
      current: thread,
      loading: false,
      threadAccess: { status: "ready" },
    });
    app.setReadingThread(thread.id);
    assert.equal(
      app.get().unreadCompletions[thread.id],
      "first",
      "查看 Claude 时不清除 Codex 的未读提示",
    );
    app.set({ provider: "codex" });
    app.setReadingThread("another-thread");
    assert.equal(app.get().unreadCompletions[thread.id], "first");
    app.set({ current: thread, loading: true });
    app.setReadingThread(thread.id);
    assert.equal(
      app.get().unreadCompletions[thread.id],
      "first",
      "历史读取期间保留提示",
    );
    app.set({ loading: false, threadAccess: { status: "loadError" } });
    app.setReadingThread(thread.id);
    assert.equal(
      app.get().unreadCompletions[thread.id],
      "first",
      "历史读取失败保留提示",
    );
    app.set({ threadAccess: { status: "ready" } });
    app.setReadingThread(thread.id);
    assert.deepEqual(app.get().unreadCompletions, {}, "成功阅读后清除提示");
    await finish("first");
    assert.deepEqual(
      app.get().unreadCompletions,
      {},
      "重复结束通知保持已读状态",
    );

    await start("visible");
    await finish("visible");
    assert.deepEqual(
      app.get().unreadCompletions,
      {},
      "当前正在阅读的对话完成后保持无提示",
    );
    app.setReadingThread(null);
    await start("hidden");
    await finish("hidden");
    assert.equal(
      app.get().unreadCompletions[thread.id],
      "hidden",
      "后台页面完成后保留未读提示",
    );
    app.setReadingThread(thread.id);
    assert.deepEqual(app.get().unreadCompletions, {}, "回到当前对话后清除提示");

    app.setReadingThread(null);
    for (const status of ["failed", "interrupted"]) {
      await start(status);
      await finish(status, status);
      assert.deepEqual(
        app.get().unreadCompletions,
        {},
        status + " 保持无成功提示",
      );
    }
    await start("previous");
    await finish("previous");
    await start("next");
    assert.deepEqual(app.get().unreadCompletions, {}, "新轮次开始清除旧提示");
    await finish("previous");
    assert.equal(app.get().active[thread.id], "next");
    assert.deepEqual(
      app.get().unreadCompletions,
      {},
      "迟到结束通知保持当前运行状态",
    );
    await finish("next");
    assert.equal(app.get().unreadCompletions[thread.id], "next");
    await emit("thread/archived", { threadId: thread.id });
    assert.deepEqual(app.get().unreadCompletions, {}, "归档清除提示");

    app.set({ unreadCompletions: { [thread.id]: "delete-result" } });
    await app.deleteThread(thread);
    assert.deepEqual(app.get().unreadCompletions, {}, "删除清除提示");
  } finally {
    await app.loadThreads();
    app.setReadingThread(null);
    app.set(original);
  }
}
