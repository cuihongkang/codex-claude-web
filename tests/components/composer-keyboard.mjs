import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

import { keyEvent as event } from "../helpers/keyboard.mjs";

export async function testComposerKeyboard(app, fixture) {
  const { requests } = fixture;
  let view;
  app.set({ draft: "键盘发送验证", items: [] });
  await act(async () => {
    view = create(React.createElement(app.Composer));
  });
  assert.equal(
    view.root.findAll((n) => n.props["aria-label"] === "执行权限").length,
    0,
  );
  const input = view.root.findByType("textarea");
  const enter = event({});
  await act(async () => input.props.onKeyDown(enter));
  assert(!enter.prevented);
  assert(!requests.some((r) => r.method === "turn/start"));
  const composing = event({
    ctrlKey: true,
    nativeEvent: { isComposing: true },
  });
  await act(async () => input.props.onKeyDown(composing));
  assert(!requests.some((r) => r.method === "turn/start"));
  await act(async () => input.props.onKeyDown(event({ ctrlKey: true })));
  assert.equal(requests.filter((r) => r.method === "turn/start").length, 1);
  assert.equal(
    requests.find((r) => r.method === "turn/start").params.approvalPolicy,
    "never",
  );
  assert.deepEqual(
    requests.find((r) => r.method === "turn/start").params.sandboxPolicy,
    { type: "dangerFullAccess" },
  );
  await act(async () => view.unmount());
  console.log("PASS Enter 保留换行、中文输入确认不发送、Ctrl+Enter 发送一次");
}
