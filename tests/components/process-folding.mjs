import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { setTimeout as delay } from "node:timers/promises";

export async function testProcessFolding(app, fixture) {
  const original = app.get(),
    originalFetch = globalThis.fetch;
  let view, release;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/translate");
    const { texts } = JSON.parse(options.body);
    await new Promise((resolve) => (release = resolve));
    return Response.json({
      translations: texts.map(() => "较早活动的迟到译文。"),
    });
  };
  const oldItems = [
    {
      id: "old-thought",
      type: "reasoning",
      turnId: "old-turn",
      content: ["历史思考正文。"],
    },
    {
      id: "old-progress",
      type: "agentMessage",
      turnId: "old-turn",
      text: "历史中途回复。",
    },
    {
      id: "old-answer",
      type: "agentMessage",
      turnId: "old-turn",
      text: "历史最终回答。",
    },
  ];
  const emit = (method, params) =>
    act(async () =>
      fixture.socket.emit(method, {
        threadId: "fixture",
        turnId: "fold-turn",
        ...params,
      }),
    );
  const item = (entry) => emit("item/completed", { item: entry });
  const visible = () => JSON.stringify(view.toJSON());
  const detached = () =>
    view.root.findAllByType("article").filter((node) => {
      if (!node.props.className?.includes("assistant-message")) return false;
      for (let parent = node.parent; parent; parent = parent.parent)
        if (parent.props.className === "process-group") return false;
      return true;
    });
  try {
    app.set({
      current: { id: "fixture" },
      loading: false,
      items: oldItems,
      questions: [],
      turns: { fixture: [{ id: "old-turn", status: "completed" }] },
      turnTimings: {},
      active: { fixture: "fold-turn" },
    });
    await act(async () => {
      view = create(React.createElement(app.Conversation));
    });
    await item({
      id: "fold-thought",
      type: "reasoning",
      content: ["Translate the earlier folding activity."],
    });
    await act(async () => delay(150));
    assert.equal(typeof release, "function");
    const progress = {
      id: "fold-progress",
      type: "agentMessage",
      phase: null,
      text: "中途核对完毕，继续工作。",
    };
    await item(progress);
    assert.equal(detached().length, 1, "运行中的无阶段回复仍属于工作过程");
    assert(visible().includes(progress.text), "仅预览最新中途回复");
    assert(!visible().includes("Translate the earlier folding activity."));
    assert(!visible().includes("历史中途回复。"));
    await act(async () => {
      release();
      await delay(20);
    });
    assert(!visible().includes("较早活动的迟到译文。"));
    await item({
      id: "fold-tool",
      type: "commandExecution",
      command: "npm run check",
      status: "completed",
    });
    assert(visible().includes("运行项目检查"));
    assert(!visible().includes(progress.text));
    await item({
      id: "fold-current",
      type: "reasoning",
      content: ["当前活动的思考。"],
    });
    assert(visible().includes("当前活动的思考。"));
    assert(!visible().includes("运行项目检查"));
    await item({
      id: "fold-answer",
      type: "agentMessage",
      text: "本轮最终回答。",
    });
    assert.equal(detached().length, 1, "缺少阶段标记时由轮次结束确认最终回答");
    await emit("turn/completed", {
      turn: { id: "fold-turn", status: "completed" },
    });
    assert.equal(detached().length, 2);
    assert(!visible().includes("当前活动的思考。"));
    assert(!visible().includes(progress.text));
    assert.equal(
      view.root.findAllByProps({ className: "process-content process-preview" })
        .length,
      0,
    );
    await emit("turn/started", {
      turn: { id: "next-turn", status: "inProgress" },
    });
    await emit("item/completed", {
      turnId: "next-turn",
      item: { id: "next-fold", type: "agentMessage", text: "下一轮当前进度。" },
    });
    assert.equal(detached().length, 2);
    assert.equal(
      view.root.findAllByProps({ className: "process-content process-preview" })
        .length,
      1,
    );
    assert(visible().includes("下一轮当前进度。"));
    assert(!visible().includes(progress.text));
    await act(async () => view.unmount());
    view = null;
    const items = [{ ...progress, turnId: "readonly-turn" }];
    const renderReadOnly = (status) =>
      React.createElement(app.ReadOnlyConversation, {
        items,
        turns: [{ id: "readonly-turn", status }],
        cwd: "/fixture",
      });
    await act(async () => {
      view = create(renderReadOnly("inProgress"));
    });
    assert.equal(detached().length, 0, "子代理的无阶段中途回复收入过程");
    await act(async () => view.update(renderReadOnly("completed")));
    assert.equal(detached().length, 1, "子代理完成后显示最终回复");
  } finally {
    release?.();
    if (view) await act(async () => view.unmount());
    app.set(original);
    globalThis.fetch = originalFetch;
  }
  console.log(
    "PASS 无阶段中途回复收纳、最新活动替换、迟到翻译、完成和下一轮隔离及子代理展示",
  );
}
