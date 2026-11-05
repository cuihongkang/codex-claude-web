import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

import { projectGroups } from "../../client/src/domain/thread-order.js";
export async function testProjectFolders(app, fixture) {
  const { requests } = fixture;
  let projectView;
  app.set({ defaultCwd: "/default", cwd: "/previous-project" });
  await act(async () => {
    projectView = create(
      React.createElement(app.ProjectGroup, { path: "" }, "无项目对话"),
    );
  });
  assert(JSON.stringify(projectView.toJSON()).includes("未分类"));
  assert(!JSON.stringify(projectView.toJSON()).includes("无项目对话"));
  assert.equal(projectView.root.findAllByType("button").length, 2);
  await act(async () =>
    projectView.root
      .findByProps({ title: "在 未分类 中新建对话" })
      .props.onClick(),
  );
  assert.equal(app.get().projectless, true);
  assert.equal(app.get().cwd, "/default");
  assert.equal(app.get().current, null);
  assert.equal(
    requests.filter((r) => r.method === "lan/projectless/prepare").length,
    0,
  );
  await act(async () =>
    projectView.root.findByProps({ title: "未指定项目的对话" }).props.onClick(),
  );
  assert(JSON.stringify(projectView.toJSON()).includes("无项目对话"));
  await act(async () => projectView.unmount());
  await act(async () => {
    projectView = create(
      React.createElement(app.ProjectGroup, { path: "/code/x" }, "项目对话"),
    );
  });
  assert.equal(projectView.root.findAllByType("button").length, 3);
  await act(async () =>
    projectView.root.findByProps({ title: "在 x 中新建对话" }).props.onClick(),
  );
  assert.equal(app.get().cwd, "/code/x");
  assert.equal(app.get().projectless, false);
  await act(async () => app.newChat(undefined, { reuseDirectory: true }));
  assert.equal(app.get().current, null);
  assert.equal(app.get().cwd, "/code/x");
  assert.equal(app.get().projectless, false);
  assert.equal(app.get().projectlessCwd, null);
  await act(async () => projectView.unmount());
  console.log("PASS 未分类分组展示与折叠、实际项目目录和新建对话入口");

  {
    const conversations = Array.from({ length: 8 }, (_, index) =>
      React.createElement(
        "div",
        { key: index, className: "fixture-thread" },
        `对话 ${index}`,
      ),
    );
    const props = { path: "/compact-fixture", pinned: false };
    let view;
    await act(async () => {
      view = create(
        React.createElement(app.ProjectGroup, props, conversations),
      );
    });
    const heading = () => view.root.findByProps({ title: props.path });
    const rows = () =>
      view.root.findAllByProps({ className: "fixture-thread" });
    assert.equal(heading().props["aria-expanded"], false);
    assert.equal(rows().length, 0);
    await act(async () => heading().props.onClick());
    assert.equal(rows().length, 5);
    assert.deepEqual(
      rows().map((row) => row.children[0]),
      conversations.slice(0, 5).map((row) => row.props.children),
    );
    await act(async () =>
      view.root
        .findByProps({ "aria-label": "查看更多 compact-fixture 的对话" })
        .props.onClick(),
    );
    assert.equal(rows().length, 8);
    await act(async () =>
      view.root
        .findByProps({ "aria-label": "收起 compact-fixture 的对话" })
        .props.onClick(),
    );
    assert.equal(rows().length, 5);
    await act(async () => heading().props.onClick());
    assert.equal(rows().length, 0);
    await act(async () => view.unmount());
    await act(async () => {
      view = create(
        React.createElement(
          app.ProjectGroup,
          { ...props, pinned: true },
          conversations,
        ),
      );
    });
    assert.equal(heading().props["aria-expanded"], true);
    assert.equal(rows().length, 5);
    await act(async () =>
      view.update(
        React.createElement(
          app.ProjectGroup,
          { ...props, pinned: true },
          conversations.slice(0, 5),
        ),
      ),
    );
    assert.equal(
      view.root.findAllByProps({ className: "project-more" }).length,
      0,
    );
    await act(async () => view.unmount());
    console.log(
      "PASS 文件夹按固定状态默认收放、最新五条、查看更多全部展开与收起、五条边界",
    );
  }

  {
    const original = app.get();
    const savedProjects = localStorage.getItem("cx-projects");
    const path = "/pin-fixture";
    let view;
    try {
      app.set({ projects: [], projectOrder: ["", path], draft: "保留草稿" });
      const current = app.get().current;
      const attachments = app.get().attachments;
      await act(async () => {
        view = create(React.createElement(app.ProjectGroup, { path }));
      });
      await act(async () =>
        view.root
          .findByProps({ "aria-label": "固定 pin-fixture" })
          .props.onClick(),
      );
      assert.deepEqual(app.get().projects, [path]);
      assert.deepEqual(JSON.parse(localStorage.getItem("cx-projects")), [path]);
      assert.deepEqual(app.get().projectOrder, ["", path]);
      assert.equal(app.get().current, current);
      assert.equal(app.get().draft, "保留草稿");
      assert.equal(app.get().attachments, attachments);
      assert(
        projectGroups([], app.get().projects, []).some(([p]) => p === path),
      );
      await act(async () =>
        view.update(
          React.createElement(app.ProjectGroup, { path, pinned: true }),
        ),
      );
      const button = view.root.findByProps({
        "aria-label": "取消固定 pin-fixture",
      });
      assert.equal(button.props["aria-pressed"], true);
      await act(async () => button.props.onClick());
      assert.deepEqual(app.get().projects, []);
      assert.deepEqual(JSON.parse(localStorage.getItem("cx-projects")), []);
      assert.deepEqual(app.get().projectOrder, ["", path]);
      assert(
        !projectGroups([], app.get().projects, []).some(([p]) => p === path),
      );
      app.toggleProjectPin("");
      assert.deepEqual(app.get().projects, []);
    } finally {
      await act(async () => view?.unmount());
      app.set(original);
      if (savedProjects === null) localStorage.removeItem("cx-projects");
      else localStorage.setItem("cx-projects", savedProjects);
    }
    console.log(
      "PASS 文件夹固定持久化、空项目恢复、取消固定及当前对话草稿隔离",
    );
  }
}
