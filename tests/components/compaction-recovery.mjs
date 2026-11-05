import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testCompactionRecovery(
  app,
  requests,
  setResponse,
  emit,
  getSocket,
) {
  const original = app.get();
  const start = requests.length;
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const originalTimeout = globalThis.setTimeout;
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  document.visibilityState = "visible";
  const thread = {
    id: "compact-recovery-fixture",
    cwd: "/fixture",
    completedAt: 90,
    status: { type: "idle" },
  };
  const entry = {
    id: "old-local-task",
    status: "running",
    startedAt: 100,
    turnId: "compact-turn",
  };
  const attachment = {
    id: "keep",
    name: "note.txt",
    input: { type: "text", text: "附件" },
  };
  let turns = [
    {
      id: "newer-ordinary",
      status: "completed",
      startedAt: 120,
      items: [{ type: "userMessage" }],
    },
    {
      id: "compact-turn",
      status: "completed",
      startedAt: 100,
      completedAt: 110,
      items: [{ type: "contextCompaction" }],
    },
  ];
  let serverEntry;
  let unsupported = false;
  let holdRead;
  setResponse(({ method, params }) => {
    if (method === "model/list") return { data: [] };
    if (method === "config/read") return { config: {} };
    if (method === "account/read") return { account: null };
    if (method === "lan/projectless/read") return { directories: {} };
    if (method === "lan/compaction/check")
      return unsupported
        ? { error: { code: -32601, message: "Unknown method" } }
        : { compaction: serverEntry };
    if (method === "thread/read")
      return holdRead
        ? new Promise((resolve) => (holdRead = resolve))
        : { thread };
    if (method === "thread/resume") return { thread };
    if (method === "thread/turns/list")
      return params.itemsView === "full"
        ? {
            data: params.cursor ? turns.slice(1) : turns.slice(0, 1),
            nextCursor: params.cursor || turns.length <= 1 ? null : "next",
          }
        : { data: turns, nextCursor: null };
    if (method === "thread/list") return { data: [thread], nextCursor: null };
    return { data: [], nextCursor: null };
  });
  let view;
  try {
    app.set({
      ...original,
      current: thread,
      connected: true,
      active: { [thread.id]: entry.turnId },
      compactions: { [thread.id]: entry },
      loading: false,
      busy: false,
      threadAccess: null,
      attachments: [attachment],
    });
    app.setDraft("后台恢复后保留的草稿");
    await act(async () => {
      view = create(React.createElement(app.Composer));
    });
    let reconnect;
    globalThis.setTimeout = (callback, milliseconds, ...args) => {
      if (milliseconds === 1500) {
        reconnect = callback;
        return 0;
      }
      return originalTimeout(callback, milliseconds, ...args);
    };
    await act(async () => {
      getSocket().onclose();
      assert.equal(app.get().compactions[thread.id].status, "reconnecting");
      reconnect();
      await emit("lan/state", {
        ready: true,
        activeTurns: {},
        questions: [],
        defaultCwd: thread.cwd,
      });
    });
    assert.equal(
      app.get().compactions[thread.id].status,
      "completed",
      "旧桥接缺少整理快照时通过分页结果恢复",
    );
    assert.equal(app.get().draft, "后台恢复后保留的草稿");
    assert.deepEqual(app.get().attachments, [attachment]);
    assert.equal(
      view.root.findByProps({ "aria-label": "发送消息" }).props.disabled,
      false,
    );
    assert(
      requests.some(
        (request) =>
          request.method === "thread/turns/list" &&
          request.params.cursor === "next",
      ),
    );

    await act(async () => {
      app.set({
        compactions: {
          [thread.id]: { ...entry, turnId: undefined, status: "reconnecting" },
        },
      });
      turns = [
        {
          id: "ordinary-running",
          status: "inProgress",
          startedAt: 130,
          items: [{ type: "userMessage" }],
        },
      ];
      thread.status = { type: "active" };
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(
      app.get().compactions[thread.id].status,
      "unconfirmed",
      "普通任务不会延续整理占用",
    );

    turns = [
      {
        id: "compact-turn",
        status: "inProgress",
        startedAt: 100,
        items: [{ type: "contextCompaction" }],
      },
    ];
    await act(async () => {
      app.set({
        compactions: { [thread.id]: entry },
        active: { [thread.id]: entry.turnId },
      });
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    assert.equal(app.get().compactions[thread.id].status, "running");
    assert.equal(
      view.root.findByProps({ "aria-label": "发送消息" }).props.disabled,
      true,
    );

    serverEntry = { ...entry, status: "completed", completedAt: 140 };
    await act(async () => {
      await emit("lan/state", {
        ready: true,
        activeTurns: {},
        questions: [],
        compactions: {},
      });
      app.set({
        compactions: { [thread.id]: { ...entry, status: "reconnecting" } },
      });
    });
    await act(async () => {
      await view.root
        .findAllByType("button")
        .find((button) => button.children.includes("检查状态"))
        .props.onClick();
    });
    assert.equal(
      app.get().compactions[thread.id].status,
      "completed",
      "手动检查应用返回值",
    );

    const finished = app.get().compactions[thread.id];
    const bridgeSnapshot = () =>
      emit("lan/state", {
        ready: true,
        activeTurns: {},
        questions: [],
        compactions: { [thread.id]: finished },
      });
    await act(async () => {
      view.root.findByProps({ title: "关闭整理状态" }).props.onClick();
      await bridgeSnapshot();
    });
    assert.equal(
      app.get().compactions[thread.id],
      undefined,
      "重连快照保留关闭状态",
    );
    await act(async () => {
      app.set({ compactions: {} });
      await bridgeSnapshot();
    });
    assert.equal(
      app.get().compactions[thread.id],
      undefined,
      "新页面忽略已结束任务快照",
    );
    await act(async () => {
      app.set({ compactions: { [thread.id]: entry } });
      await bridgeSnapshot();
    });
    assert.deepEqual(
      app.get().compactions[thread.id],
      finished,
      "未结束的本地任务恢复实际结果",
    );

    unsupported = true;
    turns = [
      {
        id: "compact-turn",
        status: "completed",
        startedAt: 100,
        completedAt: 140,
        items: [{ type: "contextCompaction" }],
      },
    ];
    await act(async () => {
      app.set({ compactions: { [thread.id]: entry } });
    });
    await act(async () => {
      await app.refreshCompaction();
    });
    assert.equal(
      app.get().compactions[thread.id].status,
      "completed",
      "检查接口缺失时使用读取接口",
    );

    await act(async () => {
      await emit("lan/state", { ready: true, activeTurns: {}, questions: [] });
    });
    await act(async () => {
      app.set({
        compactions: { [thread.id]: { ...entry, status: "reconnecting" } },
      });
    });
    holdRead = true;
    let checking;
    await act(async () => {
      checking = app.refreshCompaction();
    });
    const next = { ...entry, id: "new-request", status: "starting" };
    await act(async () => {
      app.set({ compactions: { [thread.id]: next } });
      holdRead({ thread });
      await checking;
    });
    assert.equal(
      app.get().compactions[thread.id],
      next,
      "迟到检查保留新整理任务",
    );
    assert(
      !requests
        .slice(start)
        .some(
          (request) =>
            request.method === "turn/start" || request.method === "turn/steer",
        ),
    );
    console.log(
      "PASS 整理断线重连、旧桥接分页恢复、前台核对、普通轮次隔离、手动检查返回值及迟到检查隔离",
    );
  } finally {
    if (view) await act(async () => view.unmount());
    globalThis.setTimeout = originalTimeout;
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    app.set(original);
  }
}
