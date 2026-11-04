import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { setTimeout as delay } from "node:timers/promises";

export async function testReasoningText(app, fixture) {
  const original = app.get(),
    originalFetch = globalThis.fetch;
  const requests = [];
  let release, view, releaseLate;
  let failRetry = true;
  const first = "Inspecting streaming model output";
  const final =
    first + " and preserving every paragraph.\n\nChecking the final result.";
  const translations = new Map([
    [first, "检查流式模型输出"],
    [final, "检查流式模型输出并保留所有段落。\n\n核对最终结果。"],
  ]);
  translations.set("Retry streaming reasoning", "重试流式思考翻译");
  translations.set("Delayed streaming reasoning", "延迟返回的思考翻译");
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/translate");
    const { texts } = JSON.parse(options.body);
    requests.push(texts);
    if (texts.includes("Retry streaming reasoning") && failRetry)
      return Response.json({ error: "模拟翻译失败" }, { status: 502 });
    if (texts.includes("Delayed streaming reasoning"))
      await new Promise((resolve) => (releaseLate = resolve));
    if (texts.includes(first))
      await new Promise((resolve) => (release = resolve));
    return Response.json({
      translations: texts.map((text) => translations.get(text)),
    });
  };
  const emit = (method, params) =>
    act(async () =>
      fixture.socket.emit(method, {
        threadId: "fixture",
        turnId: "raw-turn",
        ...params,
      }),
    );
  const visible = () => JSON.stringify(view.toJSON());
  const open = () =>
    act(async () =>
      view.root
        .findByProps({ className: "process-history" })
        .props.onToggle({ currentTarget: { open: true } }),
    );
  try {
    app.set({
      current: { id: "fixture" },
      loading: false,
      active: { fixture: "raw-turn" },
      questions: [],
      items: [],
    });
    await act(async () => {
      view = create(React.createElement(app.Conversation));
    });
    await emit("item/started", {
      item: { id: "raw", type: "reasoning", summary: [], content: [] },
    });
    await emit("item/reasoning/textDelta", {
      itemId: "raw",
      contentIndex: 0,
      delta: first,
    });
    assert(visible().includes("思考过程"));
    assert(visible().includes(first), "翻译等待期间展示已收到的原文");
    assert.equal(
      view.root.findByProps({ className: "activity reasoning-text" }).props
        .open,
      true,
    );
    await act(async () => delay(200));
    assert.equal(typeof release, "function");
    for (const delta of [
      " and preserving",
      " every paragraph.",
      "\n\nChecking",
      " the final result.",
    ])
      await emit("item/reasoning/textDelta", {
        itemId: "raw",
        contentIndex: 0,
        delta,
      });
    assert.equal(requests.length, 1, "等待翻译时合并推理增量");
    await act(async () => release());
    assert(visible().includes("检查流式模型输出"));
    await act(async () => delay(450));
    assert(visible().includes("核对最终结果。"));
    assert.equal(app.get().items[0].content[0], final);
    assert.deepEqual(requests, [[first], [final]]);
    await emit("item/completed", {
      item: { id: "raw", type: "reasoning", summary: [], content: [final] },
    });
    await act(async () => app.set({ active: {} }));
    await open();
    assert(visible().includes("核对最终结果。"));
    await act(async () => view.unmount());
    view = null;
    await act(async () => {
      view = create(React.createElement(app.Conversation));
    });
    await open();
    await act(async () => delay(150));
    assert(visible().includes("核对最终结果。"));
    assert.equal(requests.length, 2, "完成记录与重新打开历史复用译文");
    const replace = (text) =>
      act(async () =>
        app.set({
          active: { fixture: "raw-turn" },
          items: [
            {
              id: text,
              type: "reasoning",
              turnId: "raw-turn",
              summary: [],
              content: [text],
            },
          ],
        }),
      );
    await replace("Retry streaming reasoning");
    await act(async () => delay(450));
    assert(visible().includes("Retry streaming reasoning"));
    assert(visible().includes("翻译失败，点击重试"));
    failRetry = false;
    await act(async () =>
      view.root.findByProps({ className: "translation-retry" }).props.onClick(),
    );
    await act(async () => delay(450));
    assert(visible().includes("重试流式思考翻译"));
    await replace("Delayed streaming reasoning");
    await act(async () => delay(450));
    assert.equal(typeof releaseLate, "function");
    await act(async () =>
      app.set({
        current: { id: "another-thread" },
        active: { "another-thread": "other-turn" },
        items: [
          {
            id: "other",
            type: "reasoning",
            turnId: "other-turn",
            content: ["另一个对话的思考正文。"],
          },
        ],
      }),
    );
    await act(async () => releaseLate());
    assert(visible().includes("另一个对话的思考正文。"));
    assert(!visible().includes("延迟返回的思考翻译"));
  } finally {
    if (view) await act(async () => view.unmount());
    app.set(original);
    globalThis.fetch = originalFetch;
  }
  console.log(
    "PASS 推理正文流式展示、翻译期间合并增量、译文持续更新、历史恢复、失败重试及跨对话隔离",
  );
}
