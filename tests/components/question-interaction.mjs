import assert from "node:assert/strict";
import { keyEvent as event } from "../helpers/keyboard.mjs";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testQuestionInteraction(app, fixture) {
  const { requests } = fixture;
  let view;
  {
    fixture.responseFor = (m) =>
      m.method === "thread/list" ? { data: [], nextCursor: null } : {};
    const question = {
      id: "deployment",
      header: "部署方式",
      question: "希望怎样部署？",
      isOther: true,
      isSecret: false,
      options: [
        { label: "源码", description: "在本机构建。" },
        { label: "npm", description: "安装预构建包。" },
      ],
    };
    const request = {
      id: "input-fixture",
      method: "item/tool/requestUserInput",
      params: {
        threadId: "questions",
        turnId: "question-turn",
        itemId: "question-item",
        isBlocking: true,
        autoResolutionMs: null,
        questions: [
          question,
          {
            id: "details",
            header: "补充说明",
            question: "还有哪些要求？",
            options: null,
          },
        ],
      },
    };
    const submitEvent = () => ({ preventDefault() {} });
    const showRequest = async (next = request, extra = {}) => {
      await act(async () => {
        app.set({
          connected: true,
          current: { id: "questions" },
          items: [],
          questions: [next],
          active: {},
          busy: false,
          error: "",
          ...extra,
        });
        view = create(React.createElement(app.Conversation));
      });
    };
    await showRequest(request, {
      questions: [
        request,
        {
          ...request,
          id: "other-thread",
          params: { ...request.params, threadId: "other" },
        },
      ],
    });
    assert.equal(view.root.findAllByType("form").length, 1);
    assert.equal(
      view.root.findByProps({ type: "submit" }).props.disabled,
      true,
    );
    const firstGroup = view.root.findAllByType("fieldset")[0];
    await act(async () =>
      firstGroup.findAllByType("input")[1].props.onChange(),
    );
    const details = view.root.findByType("textarea");
    await act(async () =>
      details.props.onChange({ target: { value: "第一行\n第二行" } }),
    );
    assert.equal(
      view.root.findByProps({ type: "submit" }).props.disabled,
      false,
    );
    const form = view.root.findByType("form");
    const plainEnter = event({ target: { tagName: "TEXTAREA" } });
    await act(async () => form.props.onKeyDown(plainEnter));
    assert(!plainEnter.prevented);
    const composing = event({
      ctrlKey: true,
      nativeEvent: { isComposing: true },
    });
    await act(async () => form.props.onKeyDown(composing));
    assert(!requests.some((m) => m.id === request.id));
    await act(async () => form.props.onKeyDown(event({ ctrlKey: true })));
    assert.deepEqual(
      requests.find((m) => m.id === request.id),
      {
        id: request.id,
        result: {
          answers: {
            deployment: { answers: ["npm"] },
            details: { answers: ["第一行\n第二行"] },
          },
        },
      },
    );
    assert.equal(app.get().questions.length, 1);
    assert.equal(app.get().questions[0].id, "other-thread");
    await act(async () => assert.equal(app.respond(request, {}), false));
    assert.equal(requests.filter((m) => m.id === request.id).length, 1);
    await act(async () => view.unmount());
    console.log(
      "PASS 同步提问按对话显示、多问题校验、选项和多行回答、输入法与提交快捷键、重复提交保护",
    );

    const single = {
      ...request,
      params: { ...request.params, questions: [question], isBlocking: false },
    };
    await showRequest(single);
    assert.equal(view.root.findAllByType("input")[0].props.checked, true);
    await act(async () => view.root.findAllByType("input")[2].props.onChange());
    assert.equal(
      view.root.findByProps({ type: "submit" }).props.disabled,
      true,
    );
    await act(async () =>
      view.root
        .findByType("textarea")
        .props.onChange({ target: { value: "容器\n部署" } }),
    );
    await act(async () => view.root.findAllByType("input")[1].props.onChange());
    assert.equal(view.root.findAllByType("textarea").length, 0);
    await act(async () => view.root.findAllByType("input")[2].props.onChange());
    assert.equal(view.root.findByType("textarea").props.value, "容器\n部署");
    await act(async () => app.set({ connected: false }));
    assert.equal(
      view.root.findByProps({ type: "submit" }).props.disabled,
      true,
    );
    await act(async () => assert.equal(app.respond(single, {}), false));
    assert.equal(app.get().questions.length, 1);
    await act(async () => {
      app.set({ connected: true });
      fixture.socket.readyState = 3;
    });
    await act(async () =>
      view.root.findByType("form").props.onSubmit(submitEvent()),
    );
    assert.equal(app.get().questions.length, 1);
    assert.equal(view.root.findByType("textarea").props.value, "容器\n部署");
    assert(view.root.findByProps({ role: "alert" }));
    fixture.socket.readyState = 1;
    await act(async () =>
      view.root.findByType("form").props.onSubmit(submitEvent()),
    );
    assert.deepEqual(requests.findLast((m) => m.id === request.id).result, {
      answers: { deployment: { answers: ["容器\n部署"] } },
    });
    await act(async () => view.unmount());
    console.log("PASS 非阻塞提问预选、其他回答独立保存、断线保留回答及重试");

    await showRequest({
      ...single,
      params: {
        ...single.params,
        isBlocking: true,
        questions: [
          { ...question, isOther: false },
          {
            id: "secret",
            header: "私密信息",
            question: "请输入私密值",
            isSecret: true,
            options: null,
          },
        ],
      },
    });
    assert.equal(view.root.findAllByProps({ type: "radio" }).length, 2);
    assert.equal(
      view.root.findByProps({ type: "password" }).props.autoComplete,
      "off",
    );
    await act(async () => view.unmount());
    console.log("PASS 自定义回答开关和私密输入字段");

    await showRequest(single, {
      questions: [single, { ...single, id: "second-request" }],
    });
    const names = view.root
      .findAllByProps({ type: "radio" })
      .map((node) => node.props.name);
    assert.notEqual(names[0], names[3]);
    await act(async () =>
      fixture.socket.emit("item/tool/requestUserInput", single.params, 37),
    );
    await act(async () =>
      fixture.socket.emit("item/tool/requestUserInput", single.params, "37"),
    );
    assert.equal(
      app.get().questions.filter((question) => String(question.id) === "37")
        .length,
      1,
    );
    await act(async () =>
      fixture.socket.emit("serverRequest/resolved", { requestId: 37 }),
    );
    assert.equal(app.get().questions.length, 2);
    await act(async () =>
      fixture.socket.emit("lan/state", {
        ready: true,
        activeTurns: {},
        questions: [single],
        terminals: {},
      }),
    );
    assert.equal(view.root.findAllByType("form").length, 1);
    assert.equal(view.root.findAllByType("input")[0].props.checked, true);
    await act(async () =>
      fixture.socket.emit("serverRequest/resolved", {
        threadId: "questions",
        requestId: request.id,
      }),
    );
    assert.equal(app.get().questions.length, 0);
    await act(async () =>
      fixture.socket.emit(
        "item/tool/requestUserInput",
        single.params,
        "second-request",
      ),
    );
    await act(async () =>
      fixture.socket.emit("lan/questionResolved", { id: "second-request" }),
    );
    assert.equal(view.root.findAllByType("form").length, 0);
    await act(async () => view.unmount());
    console.log(
      "PASS 多张问题卡片的单选组隔离、请求 ID 去重、重连恢复、后端清理和跨页面解决通知",
    );

    const asyncItem = {
      id: "async-question",
      type: "agentMessage",
      turnId: "async-turn",
      phase: "commentary",
      text: "",
      questions: [
        { title: "选择运行方式", options: ["源码", "npm"] },
        { title: "补充部署要求", options: null },
      ],
    };
    await showRequest(single, {
      questions: [],
      items: [asyncItem],
      active: { questions: "async-turn" },
      draft: "尚未发送的草稿",
      attachments: [{ id: "draft-file" }],
    });
    assert.equal(view.root.findAllByType("form").length, 1);
    await act(async () =>
      fixture.socket.emit("item/completed", {
        threadId: "questions",
        turnId: "async-turn",
        item: {
          id: "continued",
          type: "agentMessage",
          phase: "commentary",
          text: "继续处理中",
        },
      }),
    );
    assert.equal(view.root.findAllByType("form").length, 1);
    await act(async () =>
      view.root
        .findByType("textarea")
        .props.onChange({ target: { value: "保留配置" } }),
    );
    fixture.responseFor = (m) => {
      if (m.method === "turn/steer")
        return { error: { code: -32000, message: "模拟发送失败" } };
      return m.method === "thread/list" ? { data: [], nextCursor: null } : {};
    };
    await act(async () =>
      view.root.findByType("form").props.onSubmit(submitEvent()),
    );
    assert(view.root.findByProps({ role: "alert" }));
    assert.equal(view.root.findByType("textarea").props.value, "保留配置");
    assert.equal(
      app.get().items.some((item) => item.optimistic),
      false,
    );
    fixture.responseFor = (m) =>
      m.method === "thread/list" ? { data: [], nextCursor: null } : {};
    await act(async () =>
      view.root.findByType("form").props.onSubmit(submitEvent()),
    );
    const steer = requests.findLast((m) => m.method === "turn/steer");
    assert.equal(steer.params.expectedTurnId, "async-turn");
    assert.equal(
      steer.params.input[0].text,
      "选择运行方式\n回答：源码\n\n补充部署要求\n回答：保留配置",
    );
    assert.equal(app.get().draft, "尚未发送的草稿");
    assert.deepEqual(app.get().attachments, [{ id: "draft-file" }]);
    assert.equal(view.root.findAllByType("form").length, 0);
    assert(!JSON.stringify(view.toJSON()).includes("回答已发送"));
    await act(async () =>
      view.root
        .findByProps({ className: "process-history" })
        .props.onToggle({ currentTarget: { open: true } }),
    );
    assert(JSON.stringify(view.toJSON()).includes("回答已发送"));
    await act(async () =>
      fixture.socket.emit("item/completed", {
        threadId: "questions",
        turnId: "async-turn",
        item: {
          id: "async-answer",
          type: "userMessage",
          content: steer.params.input,
        },
      }),
    );
    assert.equal(view.root.findAllByType("form").length, 0);
    assert(JSON.stringify(view.toJSON()).includes("选择运行方式"));
    await act(async () => view.unmount());
    console.log(
      "PASS 空正文异步提问展开、后续进度保留卡片、失败重试、运行中补充、草稿和附件保留、历史回显",
    );

    await showRequest(single, {
      questions: [],
      items: [asyncItem],
      active: {},
    });
    await act(async () =>
      view.root
        .findByType("textarea")
        .props.onChange({ target: { value: "全部结束后提交" } }),
    );
    await act(async () =>
      view.root.findByType("form").props.onSubmit(submitEvent()),
    );
    assert.equal(
      requests.findLast((m) => m.method === "turn/start").params.input[0].text,
      "选择运行方式\n回答：源码\n\n补充部署要求\n回答：全部结束后提交",
    );
    await act(async () => view.unmount());
    console.log("PASS 异步提问在轮次结束后通过新轮次提交回答");

    await showRequest(single, {
      questions: [],
      items: [
        asyncItem,
        {
          ...asyncItem,
          id: "another-async-question",
          questions: [{ title: "选择配置保留策略", options: ["保留", "覆盖"] }],
        },
      ],
      active: {},
    });
    assert.equal(view.root.findAllByType("form").length, 2);
    await act(async () =>
      fixture.socket.emit("item/completed", {
        threadId: "questions",
        turnId: "async-turn",
        item: {
          id: "unrelated-input",
          type: "userMessage",
          content: [{ type: "text", text: "请继续检查其他模块。" }],
        },
      }),
    );
    assert.equal(view.root.findAllByType("form").length, 2);
    await act(async () =>
      view.root.findByType("textarea").props.onChange({
        target: { value: "单独回答第一张卡片" },
      }),
    );
    await act(async () =>
      view.root.findAllByType("form")[0].props.onSubmit(submitEvent()),
    );
    const input = requests.findLast(
      (message) => message.method === "turn/start",
    ).params.input;
    await act(async () =>
      fixture.socket.emit("item/completed", {
        threadId: "questions",
        turnId: "async-turn",
        item: { id: "first-card-answer", type: "userMessage", content: input },
      }),
    );
    assert.equal(view.root.findAllByType("form").length, 1);
    assert(
      view.root
        .findByType("form")
        .findAllByType("p")
        .some((node) => node.props.children === "选择配置保留策略"),
    );
    await act(async () => view.unmount());
    await act(async () => {
      view = create(React.createElement(app.Conversation));
    });
    assert.equal(view.root.findAllByType("form").length, 1);
    await act(async () => view.unmount());
    console.log(
      "PASS 多批异步提问独立回答，其他问题和普通补充消息保留待答卡片",
    );
  }
}
