import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testProcessTiming(app, requests, setResponse, emit) {
  const original = app.get();
  const originalNow = Date.now;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const intervals = new Map();
  let now = 1700000000000;
  let view;
  let thread = {
    id: "timing-live-fixture",
    cwd: "/timing-fixture",
    createdAt: 1,
    updatedAt: 1,
  };
  let turns = [];
  let older = [];
  let items = [];
  Date.now = () => now;
  globalThis.setInterval = (callback, interval) => {
    assert.equal(interval, 1000);
    const id = Symbol();
    intervals.set(id, callback);
    return id;
  };
  globalThis.clearInterval = (id) => intervals.delete(id);
  const tick = (milliseconds) =>
    act(async () => {
      now += milliseconds;
      for (const callback of intervals.values()) callback();
    });
  const progress = (id, turnId) => ({
    id,
    turnId,
    type: "agentMessage",
    phase: "commentary",
    text: "正在验证计时。",
  });
  const durations = () =>
    view.root.findAllByType("time").map((node) => node.children.join(""));
  setResponse(({ method, params }) => {
    if (method === "thread/read" || method === "thread/resume")
      return { thread };
    if (method === "thread/items/list")
      return { data: items.map((item) => ({ turnId: item.turnId, item })) };
    if (method === "thread/turns/list")
      return params.threadId === "timing-other-fixture"
        ? { data: turns.map((turn) => ({ ...turn, durationMs: 9000 })) }
        : params.cursor
          ? { data: older, nextCursor: null }
          : { data: turns, nextCursor: older.length ? "older" : null };
    if (method === "thread/list") return { data: [thread] };
    if (method === "lan/projectless/read") return { directories: {} };
    return { data: [] };
  });
  try {
    app.set({
      connected: true,
      current: thread,
      active: {},
      turns: {},
      turnTimings: {},
      loading: false,
      items: [progress("timing-progress", "live")],
    });
    const startedAt = now / 1000 - 12;
    await act(async () => {
      emit("turn/started", {
        threadId: thread.id,
        turn: {
          id: "live",
          status: "inProgress",
          startedAt,
          completedAt: startedAt,
          durationMs: 0,
        },
      });
      view = create(React.createElement(app.Conversation));
    });
    assert.deepEqual(durations(), ["已用时 12秒"]);
    assert.equal(intervals.size, 1);
    assert.equal(view.root.findByType("time").props.dateTime, "PT12S");
    await tick(1000);
    assert.deepEqual(durations(), ["已用时 13秒"]);
    const history = () =>
      view.root.findByProps({ className: "process-history" });
    await act(async () =>
      history().props.onToggle({ currentTarget: { open: true } }),
    );
    await tick(1000);
    assert.deepEqual(durations(), ["已用时 14秒"]);
    await act(async () => {
      emit("item/started", {
        threadId: thread.id,
        turnId: "live",
        item: {
          id: "timing-steer",
          type: "userMessage",
          content: [{ type: "text", text: "继续验证" }],
        },
      });
    });
    assert.equal(
      history().findAllByProps({ className: "process-content" }).length,
      1,
    );
    await act(async () =>
      history().props.onToggle({ currentTarget: { open: false } }),
    );
    await act(async () => view.unmount());
    assert.equal(intervals.size, 0);
    now += 47000;
    await act(async () => {
      view = create(React.createElement(app.Conversation));
    });
    assert.deepEqual(durations(), ["已用时 1分1秒"]);
    assert.equal(intervals.size, 1);
    await act(async () => {
      emit("turn/completed", {
        threadId: thread.id,
        turn: {
          id: "live",
          status: "completed",
          startedAt,
          completedAt: startedAt + 66,
          durationMs: 65800,
        },
      });
    });
    assert.deepEqual(durations(), ["总耗时 1分5秒"]);
    assert.equal(intervals.size, 0);
    await tick(60000);
    assert.deepEqual(durations(), ["总耗时 1分5秒"]);
    turns = [
      {
        id: "live",
        status: "inProgress",
        startedAt: null,
        completedAt: null,
        durationMs: null,
      },
    ];
    await act(async () =>
      app.rpc("thread/turns/list", { threadId: thread.id }),
    );
    assert.deepEqual(durations(), ["总耗时 1分5秒"]);

    for (const status of ["failed", "interrupted"]) {
      await act(async () => {
        app.set({ items: [progress(status + "-progress", status)] });
        emit("turn/started", {
          threadId: thread.id,
          turn: { id: status, status: "inProgress" },
        });
      });
      assert.deepEqual(durations(), ["已用时 0秒"]);
      await tick(3000);
      assert.deepEqual(durations(), ["已用时 3秒"]);
      await act(async () =>
        emit("turn/completed", {
          threadId: thread.id,
          turn: { id: status, status },
        }),
      );
      assert.deepEqual(durations(), ["总耗时 3秒"]);
      assert.equal(intervals.size, 0);
    }
    await act(async () => view.unmount());
    thread = {
      id: "timing-history-fixture",
      cwd: "/timing-history",
      createdAt: 1,
      updatedAt: 1,
    };
    turns = [
      {
        id: "recent",
        status: "completed",
        startedAt: 100,
        completedAt: 226,
        durationMs: 125800,
      },
    ];
    older = [
      {
        id: "older",
        status: "completed",
        startedAt: 10,
        completedAt: 70,
        durationMs: null,
      },
    ];
    items = [
      progress("recent-progress", "recent"),
      progress("older-progress", "older"),
    ];
    const firstRequest = requests.length;
    await act(async () => {
      await app.openThread(thread.id);
      view = create(React.createElement(app.Conversation));
    });
    assert.deepEqual(durations(), ["总耗时 1分0秒", "总耗时 2分5秒"]);
    assert(
      requests
        .slice(firstRequest)
        .some(
          (request) =>
            request.method === "thread/turns/list" &&
            request.params.cursor === "older",
        ),
    );
    assert.equal(intervals.size, 0);
    await act(async () =>
      app.rpc("thread/turns/list", { threadId: "timing-other-fixture" }),
    );
    assert.equal(
      app.get().turnTimings["timing-other-fixture"].recent.durationMs,
      9000,
    );
    assert.equal(app.get().turnTimings[thread.id].recent.durationMs, 125800);
    assert.deepEqual(durations(), ["总耗时 1分0秒", "总耗时 2分5秒"]);
    await act(async () => {
      view.unmount();
      view = create(React.createElement(app.Conversation));
    });
    assert.deepEqual(durations(), ["总耗时 1分0秒", "总耗时 2分5秒"]);
    await act(async () =>
      app.set({ items: [progress("unknown-progress", "unknown")] }),
    );
    assert.deepEqual(durations(), []);
  } finally {
    await act(async () => view?.unmount());
    assert.equal(intervals.size, 0);
    Date.now = originalNow;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    app.set(original);
  }
  console.log(
    "PASS 工作过程每秒计时、展开及引导后延续、完成固定耗时、失败中断、分页历史恢复与对话隔离",
  );
}
