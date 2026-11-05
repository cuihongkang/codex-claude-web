import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { setTimeout as delay } from "node:timers/promises";

export async function testTranslationLifecycle(app, fixture) {
  const { requests } = fixture;
  let view;
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
    const history = () =>
      view.root.findByProps({ className: "process-history" });
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
    assert.equal(localStorage.getItem("cx-summary-zh-v1"), null);
    endpointMissing = true;
    await updateSummary(
      "Recovering translation",
      "Streaming summary with more text and final details",
    );
    await act(async () => delay(50));
    const retry = view.root
      .findAllByType("button")
      .find((button) => button.children.includes("标题翻译失败，点击重试"));
    assert.match(retry.props.title, /翻译暂不可用/);
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
}
