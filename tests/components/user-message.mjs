import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";
import {
  annotationMessage,
  parseAnnotations,
} from "../../client/src/domain/annotations.js";
import { fileReferenceInput } from "../../client/src/domain/user-message.js";

export async function testUserMessage(app, requests, setResponse) {
  const original = app.get();
  const thread = { id: "user-context-fixture", cwd: "/fixture" };
  const file = {
    name: "planner.js",
    path: "/fixture/planner.js",
    directory: false,
  };
  const entries = [
    {
      text: "轨迹原文",
      annotation: "补充约束",
      source: { messageId: "answer" },
    },
  ];
  const item = {
    id: "context-user",
    type: "userMessage",
    turnId: "original-turn",
    content: [
      { type: "text", text: annotationMessage(entries, "检查 @planner.js。") },
      fileReferenceInput(file),
    ],
  };
  let view,
    fail = true,
    reverted = false;
  const beforeRequests = requests.length;
  setResponse(({ method }) => {
    if (method === "thread/turns/list")
      return {
        data: reverted
          ? []
          : [{ id: item.turnId, status: "completed", items: [item] }],
        nextCursor: null,
      };
    if (method === "thread/revert") {
      reverted = true;
      return { thread };
    }
    if (method === "turn/start")
      return fail
        ? { error: { message: "模拟发送失败" } }
        : { turn: { id: "context-turn", status: "completed" } };
    if (method === "thread/list") return { data: [thread], nextCursor: null };
    return {};
  });
  try {
    app.set({
      connected: true,
      current: thread,
      items: [item],
      active: {},
      questions: [],
      plans: {},
      turns: {},
      loading: false,
      busy: false,
      threadAccess: null,
      draft: "底部未发送草稿",
      attachments: [],
    });
    await act(async () => {
      view = create(React.createElement(app.Conversation));
    });
    const bubble = view.root.findByProps({ className: "user-bubble" });
    const rendered = JSON.stringify(
      bubble.children.map((child) =>
        typeof child === "string"
          ? child
          : child
              .findAll((node) => typeof node.type === "string")
              .map((node) =>
                node.children.filter((child) => typeof child === "string"),
              ),
      ),
    );
    assert(
      !/引用本机|按需读取|Response annotations|response-annotations|My request/.test(
        rendered,
      ),
    );
    assert.equal(
      view.root.findAllByProps({ className: "user-file-reference" }).length,
      1,
    );
    const link = view.root.findByProps({ className: "user-file-reference" });
    assert.equal(link.type, "a");
    assert.equal(link.props.href, file.path);
    let prevented = false;
    await act(async () =>
      link.props.onClick({
        preventDefault() {
          prevented = true;
        },
      }),
    );
    assert(prevented);
    assert.equal(app.get().panel, "files");
    assert.equal(app.get().panelFile, file.path);
    assert.equal(app.get().contextOpen, true);
    assert.equal(
      view.root.findByProps({ className: "annotation-card" }).props.open,
      undefined,
    );
    const editButton = () => view.root.findByProps({ title: "编辑上一条消息" });
    const editor = () => view.root.findByProps({ "aria-label": "编辑消息" });
    const form = () => view.root.findByType("form");
    await act(async () => editButton().props.onClick());
    assert.equal(editor().props.value, "检查 @planner.js。");
    assert.equal(app.get().draft, "底部未发送草稿");
    assert.equal(app.get().attachments.length, 0);
    assert.equal(
      view.root.findAllByProps({ className: "user-bubble" }).length,
      0,
    );
    await act(async () =>
      view.root
        .findAllByType("button")
        .find((node) => node.children.includes("取消"))
        .props.onClick(),
    );
    assert.equal(view.root.findAllByType("form").length, 0);
    assert.equal(
      requests
        .slice(beforeRequests)
        .filter((r) => /revert|rollback|turn\/start/.test(r.method)).length,
      0,
    );
    await act(async () => editButton().props.onClick());
    await act(async () =>
      editor().props.onChange({ target: { value: "修改后的消息" } }),
    );
    await act(async () => form().props.onSubmit({ preventDefault() {} }));
    assert.equal(editor().props.value, "修改后的消息");
    assert.equal(app.get().draft, "底部未发送草稿");
    assert.match(app.get().error, /模拟发送失败/);
    fail = false;
    await act(async () => form().props.onSubmit({ preventDefault() {} }));
    const sent = requests
      .filter((request) => request.method === "turn/start")
      .at(-1).params.input;
    assert.deepEqual(parseAnnotations(sent[0].text).annotations, entries);
    assert.equal(parseAnnotations(sent[0].text).text, "修改后的消息");
    assert.deepEqual(sent[1], fileReferenceInput(file));
    assert.equal(
      requests.slice(beforeRequests).filter((r) => r.method === "thread/revert")
        .length,
      1,
    );
    assert.equal(view.root.findAllByType("form").length, 0);
    assert.equal(
      app.get().items.some((entry) => entry.id === item.id),
      false,
    );
    assert.equal(app.get().draft, "底部未发送草稿");
    assert.equal(app.get().attachments.length, 0);
  } finally {
    await act(async () => view?.unmount());
    localStorage.removeItem(`cx-annotation-drafts-${thread.id}`);
    app.set(original);
  }
}
