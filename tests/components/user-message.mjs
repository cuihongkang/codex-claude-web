import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";
import {
  annotationMessage,
  parseAnnotations,
} from "../../client/src/annotations.js";
import { fileReferenceInput } from "../../client/src/user-message.js";

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
    content: [
      { type: "text", text: annotationMessage(entries, "检查 @planner.js。") },
      fileReferenceInput(file),
    ],
  };
  let view,
    fail = true;
  setResponse(({ method }) => {
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
      draft: "",
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
    await act(async () => app.editUserMessage(item));
    assert.equal(app.get().draft, "检查 @planner.js。");
    assert.deepEqual(app.get().attachments[0].input, fileReferenceInput(file));
    const key = `cx-annotation-drafts-${thread.id}`;
    const draft = JSON.parse(localStorage.getItem(key))[0];
    assert.equal(draft.annotation, "补充约束");
    await act(async () => app.editUserMessage(item));
    assert.equal(app.get().attachments.length, 1);
    assert.equal(JSON.parse(localStorage.getItem(key)).length, 1);
    await act(async () => app.submitComposer());
    assert.equal(app.get().draft, "检查 @planner.js。");
    assert.equal(app.get().attachments.length, 1);
    assert.equal(JSON.parse(localStorage.getItem(key)).length, 1);
    fail = false;
    await act(async () => app.submitComposer());
    const sent = requests
      .filter((request) => request.method === "turn/start")
      .at(-1).params.input;
    assert.deepEqual(parseAnnotations(sent[0].text).annotations, entries);
    assert.deepEqual(sent[1], fileReferenceInput(file));
    assert.equal(app.get().draft, "");
    assert.equal(app.get().attachments.length, 0);
    assert.equal(localStorage.getItem(key), null);
  } finally {
    await act(async () => view?.unmount());
    localStorage.removeItem(`cx-annotation-drafts-${thread.id}`);
    app.set(original);
  }
}
