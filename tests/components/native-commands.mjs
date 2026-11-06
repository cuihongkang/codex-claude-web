import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testNativeCommands(app, requests, setResponse) {
  const original = app.get(),
    thread = { id: "backend:claude:native-command", cwd: "/native-command" };
  const attachment = {
    id: "native-image",
    input: { type: "image", url: "data:image/png;base64,AQ==" },
  };
  let fail = true;
  try {
    setResponse(({ method }) => {
      if (method === "turn/start")
        return fail
          ? { error: { message: "native-command-write-failed" } }
          : { turn: { id: "native-command-turn", status: "completed" } };
      if (["thread/list", "skills/list"].includes(method)) return { data: [] };
      return {};
    });
    app.set({
      ...original,
      current: thread,
      cwd: thread.cwd,
      backends: [{ id: "claude", type: "claude", enabled: true }],
      backendId: "claude",
      providerId: "fixture",
      nativeCommands: [
        {
          name: "usage",
          description: "Actual native usage command",
          builtin: true,
          argumentHint: "",
        },
      ],
      busy: false,
      loading: false,
      connected: true,
      active: {},
      items: [],
      threadAccess: { threadId: thread.id, status: "ready" },
      compactions: {},
      attachments: [attachment],
    });
    const skill = {
      name: "native-skill",
      description: "Native skill",
      native: true,
    };
    let dialog;
    setResponse(({ method }) => {
      if (method === "skills/list")
        return {
          data: [{ cwd: thread.cwd, skills: [skill] }],
          commands: [{ name: skill.name }],
        };
      if (method === "thread/list") return { data: [] };
      return {};
    });
    app.setDraft("保留正文");
    await act(async () => {
      dialog = create(React.createElement(app.SkillsDialog));
    });
    const skillButton = dialog.root
      .findAllByType("button")
      .find((node) => node.props.className === "catalog-card");
    await act(async () => {
      skillButton.props.onClick();
    });
    assert.equal(app.get().draft, "/native-skill 保留正文");
    assert.deepEqual(app.get().attachments, [attachment]);
    await act(async () => dialog.unmount());
    setResponse(({ method }) => {
      if (method === "turn/start")
        return fail
          ? { error: { message: "native-command-write-failed" } }
          : { turn: { id: "native-command-turn", status: "completed" } };
      if (["thread/list", "skills/list"].includes(method)) return { data: [] };
      return {};
    });
    app.set({
      nativeCommands: [
        {
          name: "usage",
          description: "Actual native usage command",
          builtin: true,
          argumentHint: "",
        },
      ],
    });
    app.setDraft("/usage");
    const offset = requests.length;
    await act(async () => {
      assert.equal(await app.runComposerCommand("/usage"), true);
    });
    const failed = requests
      .slice(offset)
      .find((request) => request.method === "turn/start");
    assert.equal(failed.params.input[0].text, "/usage");
    assert.deepEqual(failed.params.input[1], attachment.input);
    assert.equal(failed.params.providerId, "fixture");
    assert.equal(app.get().draft, "/usage");
    assert.deepEqual(app.get().attachments, [attachment]);
    assert.equal(app.get().error, "native-command-write-failed");
    fail = false;
    await act(async () => {
      assert.equal(await app.runComposerCommand("/usage"), true);
    });
    assert.equal(app.get().draft, "");
    assert.deepEqual(app.get().attachments, []);
    assert.equal(
      requests
        .slice(offset)
        .filter((request) => request.method === "turn/start").length,
      2,
    );
    console.log(
      "PASS 原生扩展命令发送、失败保留附件与草稿、重试成功清理提交快照",
    );
  } finally {
    app.set(original);
  }
}
