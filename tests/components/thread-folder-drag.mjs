import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { projectGroups } from "../../client/src/domain/thread-order.js";

export async function testThreadFolderDrag(app, fixture) {
  const original = app.get();
  const originalWindow = globalThis.window;
  globalThis.window = new EventTarget();
  const respond = fixture.responseFor;
  const originalPins = localStorage.getItem("cx-pins");
  let view;
  const thread = { id: "folder-drag", cwd: "/source", name: "移动对话" };
  const moved = {
    ...thread,
    cwd: "/target",
    folderPath: "/target",
    folderRevision: 1,
  };
  const event = {
    dataTransfer: {
      types: ["application/x-claudex-thread"],
      getData: () => thread.id,
    },
    preventDefault() {},
  };
  try {
    app.set({
      threads: [thread],
      pins: [thread.id],
      current: thread,
      cwd: thread.cwd,
      draft: "保留草稿",
      error: "",
    });
    fixture.responseFor = (request) =>
      request.method === "lan/thread/move"
        ? { thread: moved }
        : respond(request);
    await act(async () => {
      view = create(React.createElement(app.ProjectGroup, { path: "/target" }));
    });
    const heading = () => view.root.find((node) => node.props.onDrop);
    await act(async () => heading().props.onDragOver(event));
    assert.ok(heading().props.className.includes("drop-target"));
    await act(async () => heading().props.onDrop(event));
    assert.equal(app.get().current.folderPath, "/target");
    assert.equal(app.get().cwd, "/target");
    assert.ok(!app.get().pins.includes(thread.id));
    assert.equal(app.get().draft, "保留草稿");
    assert.equal(heading().props["aria-busy"], false);
    assert.equal(
      view.root.findByProps({ title: "/target" }).props["aria-expanded"],
      true,
    );
    assert.ok(
      projectGroups(app.get().threads, [], []).find(
        ([path]) => path === "/target",
      ),
    );
    fixture.responseFor = () => ({ error: { message: "保存失败" } });
    await act(async () => heading().props.onDrop(event));
    assert.equal(app.get().error, "保存失败");
    assert.deepEqual(app.get().current, app.get().threads[0]);
    assert.equal(app.get().cwd, "/target");
    fixture.socket.emit("thread/folder/updated", {
      thread: { ...moved, folderPath: "", folderRevision: 2 },
    });
    assert.equal(app.get().projectless, true);
    assert.equal(app.get().cwd, "/target");
    fixture.socket.emit("thread/folder/updated", { thread: moved });
    assert.equal(app.get().current.folderRevision, 2);
    assert.equal(projectGroups(app.get().threads, [], [])[0][0], "");
  } finally {
    await act(async () => view?.unmount());
    fixture.responseFor = respond;
    app.set(original);
    if (originalPins === null) localStorage.removeItem("cx-pins");
    else localStorage.setItem("cx-pins", originalPins);
    globalThis.window = originalWindow;
  }
  console.log("PASS 拖放归属、目录及草稿、保存失败、多页面通知和迟到版本隔离");
}
