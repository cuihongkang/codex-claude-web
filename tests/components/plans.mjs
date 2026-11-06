import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testPlans(app, fixture) {
  const previous = fixture.responseFor;
  const original = app.get();
  const threadId = "plan-fixture";
  const user = {
    id: "plan-user",
    type: "userMessage",
    turnId: "plan-turn",
    content: [{ type: "text", text: "制定方案" }],
  };
  const plan = {
    id: "proposal",
    type: "plan",
    turnId: "plan-turn",
    text: "# 改进计划\n\n1. 调整入口\n2. 验证恢复",
  };
  let fail = true;
  fixture.responseFor = ({ method }) => {
    if (method === "turn/start")
      return fail
        ? { error: { message: "模拟执行失败" } }
        : { turn: { id: "implementation", status: "inProgress" } };
    return method === "thread/list" ? { data: [] } : {};
  };
  app.set({
    connected: true,
    current: { id: threadId },
    loading: false,
    busy: false,
    mode: "plan",
    active: { [threadId]: "plan-turn" },
    threadAccess: { threadId, status: "ready" },
    turns: {},
    turnTimings: {},
    items: [user],
    compactions: {},
    questions: [],
  });
  let view;
  const emit = (method, params) =>
    act(async () =>
      fixture.socket.emit(method, { threadId, turnId: "plan-turn", ...params }),
    );
  const buttons = () =>
    view.root
      .findAllByType("button")
      .filter((button) => button.children.includes("批准并执行"));
  try {
    await act(async () => {
      view = create(React.createElement(app.Conversation));
    });
    await emit("item/plan/delta", { itemId: plan.id, delta: "# 改进计划\n\n" });
    const body = () =>
      view.root
        .findAllByType("div")
        .find((node) => node.props.className?.startsWith("plan-message-body"));
    const toggle = () =>
      view.root
        .findAllByType("button")
        .find(
          (node) =>
            node.props["aria-label"] === "展开计划" ||
            node.props["aria-label"] === "收起计划",
        );
    assert(body().props.className.includes("is-collapsed"));
    await act(async () => toggle().props.onClick());
    await emit("item/plan/delta", {
      itemId: plan.id,
      delta: "1. 调整入口\n2. 验证恢复",
    });
    assert.equal(
      app.get().items.find((item) => item.id === plan.id).text,
      plan.text,
    );
    assert(JSON.stringify(view.toJSON()).includes("调整入口"));
    assert.equal(body().props.className, "plan-message-body");
    assert.equal(buttons().length, 0);
    await emit("item/completed", { item: plan });
    await emit("turn/completed", {
      turn: { id: "plan-turn", status: "completed" },
    });
    assert.equal(buttons().length, 1);
    await act(async () => app.setDraft("保留底部草稿"));
    const attachment = {
      id: "draft-file",
      input: { type: "text", text: "未发送附件" },
    };
    await act(async () => app.set({ attachments: [attachment] }));
    await act(async () => {
      assert.equal(await app.approvePlan(plan.id), false);
    });
    assert.equal(app.get().mode, "plan");
    assert.equal(buttons().length, 1);
    assert.equal(app.get().draft, "保留底部草稿");
    fail = false;
    const start = fixture.requests.length;
    let first, second;
    await act(async () => {
      first = app.approvePlan(plan.id);
      second = app.approvePlan(plan.id);
      assert.equal(await first, true);
      assert.equal(await second, false);
    });
    const sent = fixture.requests
      .slice(start)
      .filter((request) => request.method === "turn/start");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].params.collaborationMode.mode, "default");
    assert.equal(sent[0].params.input.length, 1);
    assert(sent[0].params.input[0].text.includes(plan.text));
    assert.equal(app.get().mode, "default");
    assert.equal(app.get().draft, "保留底部草稿");
    assert.deepEqual(app.get().attachments, [attachment]);
    assert.equal(buttons().length, 0);
    await act(async () =>
      app.set({ current: { id: "other-plan" }, mode: "plan", items: [] }),
    );
    await emit("item/plan/delta", { itemId: plan.id, delta: "迟到正文" });
    assert.equal(app.get().items.length, 0);
    await act(async () => app.set({ current: { id: threadId } }));
    assert.equal(app.get().mode, "default");
    await act(async () => app.set({ current: { id: "other-plan" } }));
    assert.equal(app.get().mode, "plan");
    await act(async () =>
      app.set({
        current: { id: threadId },
        mode: "plan",
        items: [user, plan],
        active: {},
      }),
    );
    let release;
    fixture.responseFor = ({ method }) =>
      method === "turn/start"
        ? new Promise((resolve) => {
            release = resolve;
          })
        : method === "thread/list"
          ? { data: [] }
          : {};
    let approval;
    await act(async () => {
      approval = app.approvePlan(plan.id);
    });
    await act(async () =>
      app.set({ current: { id: "other-plan" }, mode: "plan", items: [] }),
    );
    await act(async () => {
      release({ turn: { id: "late-implementation", status: "inProgress" } });
      await approval;
    });
    assert.equal(app.get().mode, "plan");
    await act(async () => app.set({ current: { id: threadId } }));
    assert.equal(app.get().mode, "default");
    await act(async () => view.unmount());
    await act(async () => {
      view = create(
        React.createElement(app.ReadOnlyConversation, {
          items: [user, plan],
          turns: [{ id: "plan-turn", status: "completed" }],
          cwd: "/demo/project",
        }),
      );
    });
    assert(JSON.stringify(view.toJSON()).includes("调整入口"));
    assert.equal(buttons().length, 0);
    assert(body().props.className.includes("is-collapsed"));
    await act(async () => toggle().props.onClick());
    assert.equal(body().props.className, "plan-message-body");
    console.log(
      "PASS 计划默认预览、收放及流式更新、完成后批准、失败重试、默认模式执行、重复提交和草稿附件及对话隔离",
    );
  } finally {
    await act(async () => view?.unmount());
    fixture.responseFor = previous;
    app.set(original);
  }
}
