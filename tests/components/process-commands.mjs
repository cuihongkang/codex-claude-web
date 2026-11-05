import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testProcessCommands(app, fixture) {
  const { requests } = fixture;
  let view;
  {
    const command = "/usr/bin/zsh -lc \"sed -n '20,40p' src/app.js\"";
    const description = "读取 src/app.js 的第 20–40 行";
    app.set({
      active: { fixture: "command-turn" },
      items: [
        {
          id: "read-command",
          turnId: "command-turn",
          type: "commandExecution",
          status: "completed",
          command,
          aggregatedOutput: "file contents",
          exitCode: 0,
          cwd: "/code/example",
        },
      ],
    });
    await act(async () => {
      view = create(React.createElement(app.Conversation));
    });
    const summary = () =>
      view.root.findByProps({
        className: "activity-summary",
        title: command,
      });
    assert.equal(summary().findByType("span").children.join(""), description);
    assert.equal(view.root.findAllByType("pre").length, 0);
    await act(async () => summary().props.onClick());
    assert.deepEqual(
      view.root.findAllByType("pre").map((node) => node.children.join("")),
      [command, "file contents"],
    );
    assert(
      view.root
        .findAllByType("small")
        .some((node) => node.children.join("").includes("退出码 0")),
    );
    assert(JSON.stringify(view.toJSON()).includes("/code/example"));
    await act(async () => app.set({ active: {} }));
    assert.equal(view.root.findAllByType("pre").length, 0);
    await act(async () =>
      view.root
        .findByProps({ className: "process-history" })
        .props.onToggle({ currentTarget: { open: true } }),
    );
    assert.equal(summary().findByType("span").children.join(""), description);
    await act(async () => summary().props.onClick());
    assert.equal(view.root.findAllByType("pre")[0].children.join(""), command);
    const skillCommand = "cat /skills/example/SKILL.md";
    await act(async () =>
      app.set({
        active: { fixture: "skill-turn" },
        items: [
          {
            id: "skill-command",
            turnId: "skill-turn",
            type: "commandExecution",
            command: skillCommand,
            status: "inProgress",
          },
        ],
      }),
    );
    const skillSummary = view.root.findByProps({
      className: "activity-summary",
      title: skillCommand,
    });
    assert.equal(
      skillSummary.findByType("span").children.join(""),
      "阅读技能 example",
    );
    await act(async () => skillSummary.props.onClick());
    assert.equal(
      view.root.findAllByType("pre")[0].children.join(""),
      skillCommand,
    );
    await act(async () =>
      app.set({
        items: [
          {
            id: "git-command",
            turnId: "skill-turn",
            type: "commandExecution",
            command: "git diff --check; pwd",
            status: "completed",
          },
        ],
      }),
    );
    assert.equal(
      view.root
        .findByProps({
          className: "activity-summary",
          title: "git diff --check; pwd",
        })
        .findByType("span")
        .children.join(""),
      "检查差异的空白错误；查看当前工作目录",
    );
    await act(async () => app.set({ active: {} }));
    await act(async () => view.unmount());
    console.log(
      "PASS 命令描述用于实时提示和历史记录，展开保留原始命令、输出与退出状态",
    );
  }
}
