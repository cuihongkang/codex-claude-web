import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testQuestions(app, requests, setResponse, emit) {
  const original = app.get();
  const threadId = "question-layout-fixture";
  const turnId = "question-layout-turn";
  const question = {
    id: "question-layout-item",
    type: "agentMessage",
    turnId,
    phase: "commentary",
    text: "选择安装方式",
    questions: [{ title: "选择安装方式", options: ["源码", "npm"] }],
  };
  const progress = {
    id: "question-layout-progress",
    type: "agentMessage",
    turnId,
    phase: "commentary",
    text: "正在检查安装配置",
  };
  let view;
  const visible = () => JSON.stringify(view.toJSON());
  const history = () => view.root.findByProps({ className: "process-history" });
  const toggle = (open) =>
    act(async () => history().props.onToggle({ currentTarget: { open } }));
  const mount = (patch) =>
    act(async () => {
      app.set({
        connected: true,
        current: { id: threadId },
        active: { [threadId]: turnId },
        turns: {},
        turnTimings: {},
        items: [],
        questions: [],
        loading: false,
        busy: false,
        threadAccess: null,
        ...patch,
      });
      view = create(React.createElement(app.Conversation));
    });
  setResponse(({ method }) => (method === "thread/list" ? { data: [] } : {}));
  try {
    await mount({ items: [progress, question] });
    assert(
      visible().indexOf("process-history") <
        visible().indexOf("user-input-card"),
    );
    assert.equal(
      view.root.findAllByProps({ className: "process-content process-preview" })
        .length,
      1,
    );
    assert(visible().includes("源码"));
    assert(visible().includes("npm"));
    await act(async () =>
      view.root.findAllByProps({ type: "radio" })[1].props.onChange(),
    );
    await toggle(true);
    await act(async () =>
      emit("item/completed", {
        threadId,
        turnId,
        item: {
          ...progress,
          id: "question-later-progress",
          text: "继续处理其他检查",
        },
      }),
    );
    assert.equal(
      view.root.findAllByProps({ className: "process-content" }).length,
      1,
    );
    assert.equal(view.root.findAllByType("form").length, 1);
    assert.equal(
      view.root.findAllByProps({ type: "radio" })[1].props.checked,
      true,
    );
    await act(async () =>
      view.root.findByType("form").props.onSubmit({ preventDefault() {} }),
    );
    const input = requests.findLast(
      (request) => request.method === "turn/steer",
    ).params.input;
    assert.equal(view.root.findAllByType("form").length, 0);
    let record = history().findByProps({
      className: "activity historical-questions",
    });
    assert.equal(record.type, "details");
    assert.equal(record.props.open, undefined);
    assert.equal(
      record.findByType("summary").props.className,
      "activity-summary question-record-summary",
    );
    assert.equal(
      record.findAll(
        (node) => node.type === "svg" && node.props["aria-label"] === "已选择",
      ).length,
      1,
    );
    assert(
      record
        .findByProps({ className: "answer-option recorded-option selected" })
        .findByType("b")
        .children.includes("npm"),
    );
    assert.equal(
      view.root.findAllByProps({ className: "user-bubble" }).length,
      0,
    );
    await toggle(false);
    assert(!visible().includes("回答已发送"));
    await act(async () =>
      emit("item/completed", {
        threadId,
        turnId,
        item: {
          id: "question-layout-answer",
          type: "userMessage",
          content: input,
        },
      }),
    );
    assert.equal(view.root.findAllByType("form").length, 0);
    assert(!visible().includes("回答已发送"));
    await act(async () => view.unmount());

    await mount({
      active: {},
      items: [
        progress,
        question,
        {
          id: "question-restored-answer",
          type: "userMessage",
          turnId,
          content: input,
        },
        {
          id: "question-final",
          type: "agentMessage",
          phase: "final_answer",
          turnId,
          text: "安装配置已检查",
        },
      ],
    });
    assert(!visible().includes("选择安装方式"));
    assert(visible().includes("安装配置已检查"));
    await toggle(true);
    record = history().findByProps({
      className: "activity historical-questions",
    });
    assert.equal(record.props.open, undefined);
    assert(
      record
        .findByProps({ className: "answer-option recorded-option selected" })
        .findByType("b")
        .children.includes("npm"),
    );
    assert.equal(record.findAllByType("b").length, 3);
    await act(async () => view.unmount());

    for (const status of ["completed", "failed", "interrupted"]) {
      await mount({
        items: [progress, question],
        draft: "保留主输入框草稿",
        attachments: [{ id: "question-closure-attachment" }],
      });
      await toggle(true);
      await act(async () =>
        emit("turn/completed", { threadId, turn: { id: turnId, status } }),
      );
      assert.equal(view.root.findAllByType("form").length, 0);
      assert.equal(
        history().findAllByProps({ className: "process-content" }).length,
        1,
      );
      record = history().findByProps({
        className: "activity historical-questions",
      });
      assert.equal(record.props.open, undefined);
      assert(visible().includes("提问已结束"));
      assert(!visible().includes("需要你的回答"));
      assert(!visible().includes("回答已发送"));
      assert.equal(
        record.findAllByProps({ className: "answer-option recorded-option " })
          .length,
        2,
      );
      assert.equal(app.get().draft, "保留主输入框草稿");
      assert.deepEqual(app.get().attachments, [
        { id: "question-closure-attachment" },
      ]);
      await act(async () => view.unmount());
    }

    await mount({
      items: [
        progress,
        {
          ...question,
          id: "unanswered-free-text",
          text: "请说明浏览器环境，其他检查会继续。",
          questions: [{ title: "补充浏览器环境" }],
        },
      ],
      draft: "保留补充前草稿",
      attachments: [{ id: "late-question-attachment" }],
    });
    await act(async () =>
      view.root
        .findByType("textarea")
        .props.onChange({ target: { value: "尚未提交的环境信息" } }),
    );
    await act(async () =>
      emit("turn/completed", {
        threadId,
        turn: { id: turnId, status: "completed" },
      }),
    );
    assert.equal(view.root.findAllByType("form").length, 0);
    await toggle(true);
    record = history().findByProps({
      className: "activity historical-questions",
    });
    assert.equal(record.props.open, undefined);
    assert(visible().includes("请说明浏览器环境，其他检查会继续。"));
    await act(async () => record.findByType("button").props.onClick());
    assert.equal(
      view.root.findByType("textarea").props.value,
      "尚未提交的环境信息",
    );
    assert(!visible().includes("这轮任务已结束"));
    assert(visible().includes("补充回答"));
    await act(async () =>
      view.root.findByType("form").props.onSubmit({ preventDefault() {} }),
    );
    assert.equal(
      requests.findLast((request) => request.method === "turn/start").params
        .input[0].text,
      "补充浏览器环境\n回答：尚未提交的环境信息",
    );
    assert.equal(view.root.findAllByType("form").length, 0);
    assert(visible().includes("回答已发送"));
    assert.equal(app.get().draft, "保留补充前草稿");
    assert.deepEqual(app.get().attachments, [
      { id: "late-question-attachment" },
    ]);
    await act(async () => view.unmount());

    await mount({
      active: {},
      items: [
        progress,
        question,
        {
          id: "unanswered-history-final",
          turnId,
          type: "agentMessage",
          phase: "final_answer",
          text: "已完成可独立推进的检查。",
        },
      ],
    });
    assert.equal(view.root.findAllByType("form").length, 0);
    assert(visible().includes("已完成可独立推进的检查。"));
    await toggle(true);
    record = history().findByProps({
      className: "activity historical-questions",
    });
    assert.equal(record.props.open, undefined);
    assert(visible().includes("提问已结束"));
    await act(async () => view.unmount());

    await mount({
      active: { [threadId]: "new-running-turn" },
      items: [
        question,
        { ...question, id: "running-question", turnId: "new-running-turn" },
      ],
      turnTimings: {
        [threadId]: {
          [turnId]: {
            status: "failed",
            startedAt: null,
            completedAt: null,
            durationMs: null,
          },
        },
      },
    });
    assert.equal(view.root.findAllByType("form").length, 1);
    assert.equal(
      view.root.findAllByProps({ className: "process-history" }).length,
      2,
    );
    await act(async () => view.unmount());

    const request = {
      id: "question-layout-sync",
      method: "item/tool/requestUserInput",
      params: {
        threadId,
        turnId,
        questions: [
          {
            id: "install",
            question: "选择安装方式",
            options: [
              { label: "源码", description: "本机构建" },
              { label: "npm", description: "安装预构建包" },
            ],
          },
          { id: "secret", question: "填写私密值", isSecret: true },
        ],
      },
    };
    await mount({ questions: [request] });
    assert(
      visible().indexOf("process-history") <
        visible().indexOf("user-input-card"),
    );
    await toggle(true);
    await act(async () =>
      emit("item/completed", { threadId, turnId, item: progress }),
    );
    assert.equal(
      view.root.findAllByProps({ className: "process-content" }).length,
      1,
    );
    await act(async () =>
      view.root.findAllByProps({ type: "radio" })[1].props.onChange(),
    );
    await act(async () =>
      view.root
        .findByProps({ type: "password" })
        .props.onChange({ target: { value: "fixture-private-answer" } }),
    );
    await act(async () =>
      view.root.findByType("form").props.onSubmit({ preventDefault() {} }),
    );
    assert.equal(view.root.findAllByType("form").length, 0);
    record = history().findByProps({
      className: "activity historical-questions",
    });
    assert.equal(record.type, "details");
    assert.equal(record.props.open, undefined);
    assert(visible().includes("安装预构建包"));
    assert(visible().includes("已提交私密回答"));
    assert(!visible().includes("fixture-private-answer"));
    assert.equal(
      record.findAll(
        (node) => node.type === "svg" && node.props["aria-label"] === "已选择",
      ).length,
      1,
    );
    await toggle(false);
    assert(!visible().includes("填写私密值"));
    await act(async () => view.unmount());

    await mount({ items: [progress], questions: [request] });
    await act(async () => emit("lan/questionResolved", { id: request.id }));
    assert.equal(view.root.findAllByType("form").length, 0);
    await toggle(true);
    assert(visible().includes("提问已结束"));
    assert(visible().includes("安装预构建包"));
    assert(!visible().includes("回答已发送"));
  } finally {
    if (view) await act(async () => view.unmount());
    app.set(original);
  }
  console.log(
    "PASS 提问布局、提交及未答结束后独立折叠、失败中断、历史回显、跨轮次隔离、填写保留与补充回答",
  );
}
