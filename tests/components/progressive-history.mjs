import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testProgressiveHistory(app, requests, setResponse, emit) {
  const original = app.get();
  const thread = {
    id: "progressive-history",
    name: "分阶段历史",
    cwd: "/fixture/history",
  };
  let finishPage;
  let fail = false;
  let opening;
  let view;
  setResponse(({ method, params }) => {
    if (["thread/read", "thread/resume"].includes(method)) return { thread };
    if (method !== "thread/items/list") return { data: [] };
    if (params.cursor)
      return new Promise((resolve) => {
        finishPage = () =>
          resolve(
            fail
              ? { error: { message: "较早历史读取失败" } }
              : {
                  data: [
                    {
                      turnId: "old",
                      item: {
                        id: "old-answer",
                        type: "agentMessage",
                        text: "较早的回答",
                      },
                    },
                  ],
                  nextCursor: null,
                },
          );
      });
    return {
      data: [
        {
          turnId: "recent",
          item: {
            id: "recent-answer",
            type: "agentMessage",
            text: "最近的回答",
          },
        },
      ],
      nextCursor: "older",
    };
  });
  try {
    app.newChat(thread.cwd);
    app.set({ connected: true, active: {}, questions: [], plans: {} });
    await act(async () => {
      opening = app.openThread(thread.id);
      view = create(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(app.Conversation),
          React.createElement(app.Composer),
        ),
      );
    });
    assert(finishPage);
    assert.equal(app.get().loading, false);
    assert.equal(
      app.get().threadAccess.status,
      "ready",
      "完整历史尚未完成时，独立恢复发送能力",
    );
    assert(JSON.stringify(view.toJSON()).includes("最近的回答"));
    assert.equal(view.root.findAllByProps({ "aria-label": "消息" }).length, 1);
    await act(async () => {
      app.setDraft("读取期间编辑的草稿");
      await emit("item/completed", {
        threadId: thread.id,
        turnId: "recent",
        item: {
          id: "recent-answer",
          type: "agentMessage",
          text: "读取期间更新的回答",
        },
      });
      await emit("item/completed", {
        threadId: thread.id,
        turnId: "live",
        item: { id: "live-answer", type: "agentMessage", text: "实时新增回答" },
      });
      finishPage();
      await opening;
    });
    assert.deepEqual(
      app.get().items.map((item) => item.text),
      ["较早的回答", "读取期间更新的回答", "实时新增回答"],
    );
    assert.equal(app.get().draft, "读取期间编辑的草稿");

    fail = true;
    await act(async () => {
      opening = app.openThread(thread.id);
    });
    await act(async () => {
      finishPage();
      await opening;
    });
    assert.equal(app.get().threadAccess.status, "loadError");
    assert.equal(app.get().threadAccess.message, "较早历史读取失败");
    assert(JSON.stringify(view.toJSON()).includes("最近的回答"));
    fail = false;
    await act(async () => {
      opening = app.refreshThreadAccess();
    });
    await act(async () => {
      finishPage();
      await opening;
    });
    assert.equal(app.get().threadAccess.status, "ready");
    assert.equal(app.get().items[0].id, "old-answer");

    await act(async () => {
      opening = app.openThread(thread.id);
    });
    const count = requests.filter(
      (r) => r.method === "thread/items/list",
    ).length;
    await act(async () => {
      app.newChat("/fixture/another");
      finishPage();
      await opening;
    });
    assert.equal(app.get().current, null);
    assert.deepEqual(app.get().items, []);
    assert.equal(
      requests.filter((r) => r.method === "thread/items/list").length,
      count,
    );
  } finally {
    finishPage?.();
    if (opening) await opening;
    if (view) await act(async () => view.unmount());
    app.newChat();
    app.set(original);
    localStorage.removeItem("cx-draft-progressive-history");
  }
  console.log(
    "PASS 首屏提前显示、独立恢复输入、实时覆盖、分页失败重试、草稿与切换隔离",
  );
}
