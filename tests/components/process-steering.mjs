import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testProcessSteering(app, fixture) {
  const { requests } = fixture;
  let view;
  {
    const previousResponse = fixture.responseFor;
    const turnId = "guided-turn";
    const userMessage = (id, text) => ({
      id,
      turnId,
      type: "userMessage",
      content: [{ type: "text", text }],
    });
    app.set({
      current: { id: "fixture" },
      active: { fixture: turnId },
      questions: [],
      items: [
        userMessage("original-request", "请检查机器人通用能力。"),
        {
          id: "initial-progress",
          turnId,
          type: "agentMessage",
          phase: "commentary",
          text: "开始检查模型。",
        },
      ],
    });
    await act(async () => {
      view = create(React.createElement(app.Conversation));
    });
    const history = () =>
      view.root.findByProps({ className: "process-history" });
    const order = () =>
      view.root
        .findByProps({ className: "message-column" })
        .children.filter((node) => node.props?.group || node.props?.item)
        .map((node) =>
          node.props.group
            ? "process"
            : node.findAllByProps({ "aria-label": "回复操作" }).length
              ? "actions"
              : node.props.item.id,
        );
    const emitItem = (item) =>
      act(async () =>
        fixture.socket.emit("item/completed", {
          threadId: "fixture",
          turnId,
          item,
        }),
      );
    const originalHistory = history();
    await act(async () =>
      history().props.onToggle({ currentTarget: { open: true } }),
    );
    let finishSteer, sending;
    fixture.responseFor = ({ method }) => {
      if (method === "turn/steer")
        return new Promise((resolve) => (finishSteer = resolve));
      if (method === "thread/list" || method === "thread/turns/list")
        return { data: [], nextCursor: null };
      return {};
    };
    await act(async () => {
      app.setDraft("请考虑通用能力。");
      sending = app.sendMessage();
    });
    const pendingMessage = app.get().items.find((item) => item.optimistic);
    assert.equal(pendingMessage.turnId, turnId);
    assert.deepEqual(order(), [
      "original-request",
      pendingMessage.id,
      "process",
    ]);
    assert.equal(history(), originalHistory);
    assert(JSON.stringify(view.toJSON()).includes("开始检查模型。"));
    await act(async () => {
      finishSteer({});
      assert.equal(await sending, true);
    });
    await emitItem(userMessage("first-steer", "请考虑通用能力。"));
    await emitItem({
      id: "guided-command",
      type: "commandExecution",
      command: "npm run check",
      status: "completed",
    });
    await emitItem(userMessage("last-steer", "同时检查内存占用。"));
    await emitItem({
      id: "latest-progress",
      type: "agentMessage",
      phase: "commentary",
      text: "继续验证能力上限。",
    });
    assert.deepEqual(order(), [
      "original-request",
      "first-steer",
      "last-steer",
      "process",
    ]);
    assert.equal(history(), originalHistory);
    assert.deepEqual(
      history()
        .findAllByProps({ className: "supplemental-preview" })
        .map((node) => node.children.join("")),
      ["请考虑通用能力。", "同时检查内存占用。"],
    );
    assert.equal(
      history().findAllByProps({ className: "activity supplemental-message" })
        .length,
      2,
    );
    assert.equal(
      history().findAllByProps({ className: "user-bubble" }).length,
      0,
    );
    assert.equal(
      view.root.findAllByProps({ className: "user-bubble" }).length,
      3,
    );
    assert(JSON.stringify(view.toJSON()).includes("开始检查模型。"));
    assert(JSON.stringify(view.toJSON()).includes("继续验证能力上限。"));
    await act(async () =>
      history().props.onToggle({ currentTarget: { open: false } }),
    );
    assert(!JSON.stringify(view.toJSON()).includes("开始检查模型。"));
    assert(JSON.stringify(view.toJSON()).includes("继续验证能力上限。"));
    await emitItem({
      id: "guided-answer",
      type: "agentMessage",
      phase: "final_answer",
      text: "能力检查完成。",
    });
    await act(async () => app.set({ active: {} }));
    const expectedOrder = [
      "original-request",
      "first-steer",
      "last-steer",
      "process",
      "guided-answer",
      "actions",
    ];
    assert.deepEqual(order(), expectedOrder);
    assert.equal(
      view.root.findAllByProps({ className: "process-history" }).length,
      1,
    );
    assert(!JSON.stringify(view.toJSON()).includes("继续验证能力上限。"));
    const savedItems = app.get().items;
    fixture.responseFor = ({ method }) =>
      method === "thread/items/list"
        ? {
            data: savedItems
              .slice()
              .reverse()
              .map(({ turnId, ...item }) => ({ turnId, item })),
            nextCursor: null,
          }
        : {};
    await act(async () => {
      app.set({ items: [] });
      await app.loadHistory();
    });
    assert.deepEqual(order(), expectedOrder);
    assert.equal(
      view.root.findAllByProps({ className: "process-history" }).length,
      1,
    );
    await act(async () =>
      history().props.onToggle({ currentTarget: { open: true } }),
    );
    assert.equal(
      history().findAllByProps({ className: "activity supplemental-message" })
        .length,
      2,
    );
    await act(async () => view.unmount());
    fixture.responseFor = previousResponse;
    console.log(
      "PASS 多条引导保持气泡、过程始终位于最后一条引导下方、流式与历史汇总一致、展开状态保留",
    );
  }
}
