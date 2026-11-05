import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export const contextResetItems = [
  {
    id: "user",
    type: "userMessage",
    content: [{ type: "text", text: "检查并更新项目的规划配置。" }],
  },
  {
    id: "changed-file",
    type: "fileChange",
    status: "completed",
    changes: [
      {
        path: "/fixture/annotations/planner.js",
        kind: { type: "add" },
        diff: "export const hover = true;\n",
      },
    ],
  },
  {
    id: "answer",
    type: "agentMessage",
    phase: "final_answer",
    text: "已更新规划配置，可在文件变更中查看。",
  },
];

export async function verifyContextReset({
  evaluate,
  page,
  waitFor,
  click,
  screenshot,
  output,
  buildInfo,
}) {
  const before = process.env.BROWSER_BEFORE === "1";
  const opened = `document.querySelector('.context-workspace').dataset.open==='true'`;
  const openThread = async () => {
    if (await evaluate(`innerWidth<700`)) {
      await click('button[title="显示侧栏"]');
      await waitFor(
        `document.querySelector('.sidebar.mobile-open') && document.querySelector('.sidebar').getBoundingClientRect().left>=-0.1`,
      );
    }
    await click(".thread-link");
    await waitFor(`document.querySelector('.file-change-name')`);
  };
  await click(".file-change-name");
  await waitFor(`document.querySelector('.file-diff-view')`);
  await screenshot("original-file-diff");
  await click('button[title="在当前目录新建对话"]');
  await waitFor(`!document.querySelector('.assistant-message')`);
  assert.equal(await evaluate(opened), before);
  await screenshot(before ? "before-new-chat" : "after-new-chat-light");
  if (!before) {
    assert.equal(
      await evaluate(
        `document.querySelector('.context-tools button[title="文件"]').getAttribute('aria-pressed')`,
      ),
      "false",
    );
    await click('.context-tools button[title="展开对话详情"]');
    await waitFor(`document.querySelector('.context-card')`);
    await screenshot("after-new-chat-overview");
    await click('.context-tools button[title="文件"]');
    await waitFor(`document.querySelector('.file-location')`);
    assert.equal(
      await evaluate(`!!document.querySelector('.file-diff-view')`),
      false,
    );
    await screenshot("after-new-chat-files");
    await click('button[title="在当前目录新建对话"]');
    await openThread();
    await click('.context-tools button[title="变更"]');
    await waitFor(opened);
    await click('button[title="在当前目录新建对话"]');
    assert.equal(await evaluate(opened), false);
    for (const theme of ["light", "dark"]) {
      await evaluate(`document.documentElement.dataset.theme='${theme}'`);
      await openThread();
      await click(".file-change-name");
      await waitFor(`document.querySelector('.file-diff-view')`);
      await click('button[title="在当前目录新建对话"]');
      assert.equal(await evaluate(opened), false);
      await screenshot(`after-new-chat-${theme}`);
    }
    await page("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitFor(
      `document.querySelector('.sidebar').getBoundingClientRect().right<=1`,
    );
    await openThread();
    await click(".file-change-name");
    await waitFor(`document.querySelector('.file-diff-view')`);
    await click('button[title="在当前目录新建对话"]');
    assert.equal(await evaluate(opened), false);
    await screenshot("after-new-chat-mobile");
  }
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        passed: true,
        before,
        build: buildInfo,
        data: "生产构建、隔离 WebSocket 历史与独立 Chromium 配置目录",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, before, output }));
}
