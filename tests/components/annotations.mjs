import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";
import {
  annotationMessage,
  parseAnnotations,
} from "../../client/src/domain/annotations.js";

export async function testAnnotations(app, requests, setResponse) {
  const original = app.get();
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const entries = [
    { text: "原文第一段", annotation: "请补充条件" },
    { text: "原文第二段", annotation: "请修正" },
  ];
  const thread = { id: "annotation-fixture", cwd: "/annotation-fixture" };
  let view,
    fail = false,
    finish;
  setResponse(({ method }) => {
    if (method === "turn/start" && finish)
      return new Promise((resolve) => finish(resolve));
    if (["turn/start", "turn/steer"].includes(method) && fail)
      return { error: { message: "模拟发送失败" } };
    if (method === "thread/list") return { data: [thread], nextCursor: null };
    return { data: [], directories: {} };
  });
  const text =
    '已处理。:codex-annotation{index="1"} 也已修正。:codex-annotation{index="2"}';
  const items = [
    {
      id: "annotation-user",
      type: "userMessage",
      turnId: "annotation-turn",
      content: [{ type: "text", text: annotationMessage(entries) }],
    },
    {
      id: "annotation-reply",
      type: "agentMessage",
      turnId: "annotation-turn",
      phase: "final_answer",
      text,
    },
  ];
  const node = {};
  const listeners = new Map();
  const ownerDocument = {
    body: { getBoundingClientRect: () => ({ width: 1000 }), offsetWidth: 1000 },
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };
  globalThis.document = ownerDocument;
  const options = {
    createNodeMock: () => ({
      contains: (entry) => entry === node,
      ownerDocument,
      style: {},
      scrollHeight: 40,
      scrollIntoView() {},
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ top: 0, width: 300, height: 230 }),
      addEventListener() {},
      removeEventListener() {},
    }),
  };
  let selection = { rangeCount: 0 };
  globalThis.window = {
    ...previousWindow,
    innerWidth: 1000,
    innerHeight: 700,
    getSelection: () => selection,
    addEventListener() {},
    removeEventListener() {},
  };
  const render = () =>
    React.createElement(
      React.Fragment,
      null,
      React.createElement(app.Conversation),
      React.createElement(app.Composer),
    );
  const field = () => view.root.findByProps({ "aria-label": "批注内容" });
  const save = async () =>
    act(async () =>
      view.root
        .findByProps({ className: "annotation-editor" })
        .props.onSubmit({ preventDefault() {} }),
    );
  const change = async (value) =>
    act(async () => field().props.onChange({ target: { value } }));
  const send = async () =>
    act(async () =>
      view.root.findByProps({ className: "send-button" }).props.onClick(),
    );
  const count = () =>
    requests.filter((r) => ["turn/start", "turn/steer"].includes(r.method))
      .length;
  const drafts = () =>
    JSON.parse(
      localStorage.getItem(`cx-annotation-drafts-${thread.id}`) || "[]",
    );
  const select = async (selected = "选中原文😀") => {
    selection = {
      rangeCount: 1,
      isCollapsed: false,
      toString: () => selected,
      getRangeAt: () => ({
        startContainer: node,
        endContainer: node,
        startOffset: 2,
        toString: () => selected,
        getBoundingClientRect: () => ({ left: 950, bottom: 680 }),
        cloneRange: () => ({
          selectNodeContents() {},
          setEnd() {},
          toString: () => "前缀",
        }),
      }),
    };
    await act(async () => {
      for (const listener of listeners.get("selectionchange")) listener();
    });
    await act(async () =>
      view.root.findByProps({ className: "annotation-add" }).props.onClick(),
    );
    selection = { rangeCount: 0 };
  };
  try {
    app.set({
      connected: true,
      current: thread,
      items,
      turns: { [thread.id]: [{ id: "annotation-turn", status: "completed" }] },
      active: {},
      questions: [],
      plans: {},
      loading: false,
      busy: false,
      threadAccess: null,
      draft: "",
      attachments: [],
      annotationEditor: null,
    });
    await act(async () => {
      view = create(render(), options);
    });
    assert.equal(
      view.root.findAllByProps({ className: "annotation-marker" }).length,
      2,
    );
    assert.equal(
      view.root.findAllByProps({ className: "annotation-card" }).length,
      2,
    );
    await act(async () =>
      view.root
        .findAllByProps({ className: "annotation-marker" })[0]
        .props.onClick(),
    );
    assert(JSON.stringify(view.toJSON()).includes("请补充条件"));
    await act(async () =>
      app.set({ items: [items[0], { ...items[1], text: text + " 流式更新" }] }),
    );
    assert.equal(
      view.root.findAllByProps({ className: "annotation-marker" })[0].props[
        "aria-expanded"
      ],
      true,
    );
    const initial = count();
    await select();
    await change("第一条批注");
    const pressEnter = async (extra = {}) => {
      let prevented = false;
      await act(async () =>
        view.root
          .findByProps({ className: "annotation-editor" })
          .props.onKeyDown({
            key: "Enter",
            nativeEvent: {},
            preventDefault() {
              prevented = true;
            },
            ...extra,
          }),
      );
      return prevented;
    };
    for (const extra of [
      { nativeEvent: { isComposing: true } },
      { nativeEvent: { keyCode: 229 } },
      { shiftKey: true },
    ]) {
      assert.equal(await pressEnter(extra), false);
      assert.equal(field().props.value, "第一条批注");
      assert(app.get().annotationEditor);
    }
    assert.equal(await pressEnter(), true);
    assert.equal(app.get().annotationEditor, null);
    assert.equal(drafts()[0].annotation, "第一条批注");
    assert.equal(count(), initial, "Enter 完成批注只保存草稿");
    await select("另一处原文");
    await change("第二条批注");
    await save();
    assert.equal(count(), initial, "保存多条批注期间不调用后端");
    assert.equal(drafts().length, 2);
    assert.equal(
      view.root.findByProps({ className: "send-button" }).props.disabled,
      false,
      "仅有批注时可统一发送",
    );
    await act(async () =>
      view.root.findByProps({ "aria-label": "打开批注 1" }).props.onClick(),
    );
    assert.equal(field().props.value, "第一条批注");
    await change("修订第一条");
    await save();
    await act(async () => view.unmount());
    assert.equal(
      [...listeners.values()].reduce((n, set) => n + set.size, 0),
      0,
    );
    await act(async () => {
      view = create(render(), options);
    });
    assert.equal(drafts().length, 2);
    await act(async () =>
      view.root.findByProps({ "aria-label": "打开批注 2" }).props.onClick(),
    );
    assert.equal(field().props.value, "第二条批注");
    await act(async () =>
      app.set({ current: { id: "other-annotation-fixture" }, items: [] }),
    );
    assert.equal(
      view.root.findAllByProps({ className: "annotation-attachment" }).length,
      0,
    );
    await act(async () => app.set({ current: thread, items }));
    assert.equal(field().props.value, "第二条批注");
    await save();
    const attachment = {
      id: "image",
      input: { type: "image", url: "data:image/png;base64,AQ==" },
    };
    await act(async () => {
      app.setDraft("请合并修改");
      app.set({ attachments: [attachment] });
    });
    fail = true;
    await send();
    assert.equal(drafts().length, 2);
    assert.equal(app.get().draft, "请合并修改");
    assert.deepEqual(app.get().attachments, [attachment]);
    fail = false;
    await act(async () =>
      app.set({ active: { [thread.id]: "running-fixture" } }),
    );
    await send();
    const sent = requests.filter((r) => r.method === "turn/steer").at(-1);
    assert.equal(sent.params.expectedTurnId, "running-fixture");
    const parsed = parseAnnotations(sent.params.input[0].text);
    assert.equal(parsed.text, "请合并修改");
    assert.deepEqual(
      parsed.annotations.map((e) => e.annotation),
      ["修订第一条", "第二条批注"],
    );
    assert.deepEqual(parsed.annotations[0].source, {
      messageId: "annotation-reply",
      startOffset: 2,
      endOffset: 8,
    });
    assert.equal(parsed.annotations[0].id, undefined);
    assert.deepEqual(sent.params.input[1], attachment.input);
    assert.equal(drafts().length, 0);
    assert.equal(app.get().draft, "");
    assert.equal(app.get().attachments.length, 0);

    await act(async () => app.set({ active: {}, error: "" }));
    await select();
    await change("仅发送批注");
    await save();
    await send();
    const idle = requests.filter((r) => r.method === "turn/start").at(-1);
    assert.equal(parseAnnotations(idle.params.input[0].text).text, "");
    assert.equal(drafts().length, 0);

    localStorage.setItem(
      `cx-annotation-${thread.id}-annotation-reply`,
      JSON.stringify({
        text: "旧版未发送原文",
        annotation: "旧版草稿",
        source: { messageId: "annotation-reply" },
      }),
    );
    await act(async () => view.unmount());
    await act(async () => {
      view = create(render(), options);
    });
    assert.equal(drafts()[0].annotation, "旧版草稿");
    assert.equal(
      localStorage.getItem(`cx-annotation-${thread.id}-annotation-reply`),
      null,
    );
    await act(async () =>
      view.root.findByProps({ "aria-label": "移除批注 1" }).props.onClick(),
    );

    await select();
    await change("提交快照");
    await save();
    let resolveSend, pendingSend;
    finish = (resolve) => {
      resolveSend = resolve;
    };
    await act(async () => {
      pendingSend = view.root
        .findByProps({ className: "send-button" })
        .props.onClick();
    });
    await act(async () =>
      view.root.findByProps({ "aria-label": "打开批注 1" }).props.onClick(),
    );
    await change("发送等待期间继续编辑");
    await save();
    await select("后来选中的原文");
    await change("稍后提交的新批注");
    await save();
    await act(async () => {
      app.setDraft("稍后提交的新正文");
      app.set({ attachments: [attachment] });
    });
    await act(async () => {
      resolveSend({ turn: { id: "pending-turn", status: "completed" } });
      await pendingSend;
    });
    finish = null;
    assert.deepEqual(
      drafts().map((e) => e.annotation),
      ["发送等待期间继续编辑", "稍后提交的新批注"],
    );
    assert.equal(app.get().draft, "稍后提交的新正文");
    assert.deepEqual(app.get().attachments, [attachment]);
    await act(async () =>
      view.root.findByProps({ "aria-label": "移除批注 2" }).props.onClick(),
    );
    await act(async () =>
      view.root.findByProps({ "aria-label": "移除批注 1" }).props.onClick(),
    );
    await act(async () =>
      view.update(
        React.createElement(app.RichText, {
          text: "`" + text + "`\n\n```text\n" + text + "\n```\n\n" + text,
        }),
      ),
    );
    assert.equal(
      view.root.findAllByProps({ className: "annotation-marker" }).length,
      2,
    );
    assert(
      JSON.stringify(view.root.findAllByType("code")[0].children).includes(
        ":codex-annotation",
      ),
    );
    console.log(
      "PASS 多条批注草稿、独立编辑和移除、重挂载及切换恢复、旧草稿迁移、统一提交正文与附件、失败重试、运行中补充和提交期间继续编辑隔离",
    );
  } finally {
    await act(async () => view?.unmount());
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    localStorage.removeItem(`cx-annotation-drafts-${thread.id}`);
    app.set(original);
  }
}
