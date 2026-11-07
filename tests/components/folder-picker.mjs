import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testFolderPicker(app, fixture) {
  const previous = fixture.responseFor;
  const original = app.get();
  app.set({ connected: true });
  let view;
  let chosen;
  fixture.responseFor = (request) =>
    request.method === "fs/readDirectory"
      ? {
          entries: [
            { fileName: ".config", isDirectory: true },
            { fileName: "project", isDirectory: true },
            { fileName: "readme.txt", isDirectory: false },
          ],
        }
      : previous(request);
  const mount = async () => {
    await act(async () => {
      view = create(
        React.createElement(app.FolderPicker, {
          initial: "/fixture",
          onChoose: (path) => {
            chosen = path;
          },
        }),
      );
    });
  };
  const rows = () =>
    view.root
      .findByProps({ className: "directory-list" })
      .findAllByType("button");
  const names = () => rows().map((row) => row.findByType("span").children[0]);
  const checkbox = () => view.root.findByProps({ type: "checkbox" });
  try {
    await mount();
    assert.deepEqual(names(), ["project"]);
    assert.equal(checkbox().props.checked, false);
    await act(async () =>
      checkbox().props.onChange({ target: { checked: true } }),
    );
    assert.deepEqual(names(), [".config", "project"]);
    await act(async () => rows()[0].props.onClick());
    assert.equal(
      view.root.findByProps({ "aria-label": "目录路径" }).props.value,
      "/fixture/.config",
    );
    assert.equal(checkbox().props.checked, true);
    await act(async () =>
      checkbox().props.onChange({ target: { checked: false } }),
    );
    assert.deepEqual(names(), ["project"]);
    await act(async () =>
      view.root.findByProps({ className: "primary" }).props.onClick(),
    );
    assert.equal(chosen, "/fixture/.config");
    await act(async () => view.unmount());
    await mount();
    assert.equal(checkbox().props.checked, false);
    assert.deepEqual(names(), ["project"]);
  } finally {
    if (view) await act(async () => view.unmount());
    fixture.responseFor = previous;
    app.set(original);
  }
  console.log("PASS 文件夹默认隐藏、显示开关、隐藏目录选择及重新打开恢复默认");
}
