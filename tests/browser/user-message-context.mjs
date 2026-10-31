import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { annotationMessage } from "../../client/src/annotations.js";

export const contextItems = [
  {
    id: "reference-user",
    type: "userMessage",
    content: [
      {
        type: "text",
        text: "目前 @global_planner 里面实现的全局规划以无人车为中心，能否让无人车停留、无人机在高处飞行？",
      },
      {
        type: "text",
        text: "引用本机目录：/fixture/project/global_planner\n请根据任务按需读取。",
      },
    ],
  },
  {
    id: "annotation-user",
    type: "userMessage",
    content: [
      {
        type: "text",
        text: annotationMessage(
          [
            {
              text: "轨迹规划以无人车为中心。",
              annotation: "请补充无人车停留时的轨迹约束。",
              source: { messageId: "answer", startOffset: 0, endOffset: 12 },
            },
          ],
          "也请检查 @planner.js。",
        ),
      },
      {
        type: "text",
        text: "引用本机文件：/fixture/project/planner.js\n请根据任务按需读取。",
      },
    ],
  },
  {
    id: "answer",
    type: "agentMessage",
    phase: "final_answer",
    text: "轨迹规划以无人车为中心。可以进一步检查悬停条件与轨迹约束。",
  },
];

export async function verifyUserContext({
  evaluate,
  page,
  waitFor,
  click,
  fill,
  key,
  screenshot,
  output,
  buildInfo,
}) {
  const before = process.env.BROWSER_BEFORE === "1";
  const workspaceClip = { x: 300, y: 55, width: 1130, height: 360, scale: 1 };
  const messageScreenshot = async (name) => {
    const clip = await evaluate(`(()=>{
      const boxes=[...document.querySelectorAll('.user-bubble')].map(e=>e.getBoundingClientRect());
      const x=Math.min(...boxes.map(r=>r.left))-8,y=Math.min(...boxes.map(r=>r.top))-8;
      return {x,y,width:Math.max(...boxes.map(r=>r.right))-x+8,height:Math.max(...boxes.map(r=>r.bottom))-y+8,scale:1};
    })()`);
    await screenshot(name, clip);
  };
  const bubble = `[...document.querySelectorAll('.user-bubble')].map(e=>e.innerText).join('\\n')`;
  if (before) {
    assert((await evaluate(bubble)).includes("请根据任务按需读取。"));
    await screenshot("before-context");
    await messageScreenshot("before-message-context");
    await click(
      '[data-message-id="annotation-user"] button[title="编辑并重新发送"]',
    );
    assert(
      (
        await evaluate(
          `document.querySelector('textarea[aria-label="消息"]').value`,
        )
      ).includes("# Response annotations:"),
    );
    await screenshot("before-edit");
  } else if (process.env.REFERENCE_NAVIGATION_BEFORE === "1") {
    assert.equal(
      await evaluate(`document.querySelector('.user-file-reference').tagName`),
      "SPAN",
    );
    await click(
      '.user-file-reference[title="/fixture/project/global_planner"]',
    );
    assert.equal(
      await evaluate(
        `!!document.querySelector('.context-workspace[data-open="true"]')`,
      ),
      false,
    );
    await screenshot("before-folder-click");
    await screenshot("before-folder-detail", workspaceClip);
  } else {
    const visible = await evaluate(bubble);
    assert(
      !/引用本机|按需读取|Response annotations|My request|response-annotations/.test(
        visible,
      ),
    );
    assert.equal(
      await evaluate(
        `document.querySelectorAll('.user-file-reference').length`,
      ),
      2,
    );
    assert.equal(
      await evaluate(`document.querySelector('.annotation-card').open`),
      false,
    );
    await screenshot("after-context-light");
    await messageScreenshot("after-message-context");
    await evaluate(
      `Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:async text=>{window.contextCopied=text}}})`,
    );
    await click('[data-message-id="annotation-user"] button[title="复制消息"]');
    assert.equal(
      await evaluate(`window.contextCopied`),
      "也请检查 @planner.js。\n注释 1：请补充无人车停留时的轨迹约束。",
    );
    await click('button[aria-label="对话目录"]');
    const navigation = await evaluate(
      `document.querySelector('.conversation-navigation-entries').innerText`,
    );
    assert(!/引用本机|按需读取|response-annotations/.test(navigation));
    await click('button[aria-label="收起对话目录"]');
    await click(".annotation-card summary");
    assert.equal(
      await evaluate(`document.querySelector('.annotation-card').open`),
      true,
    );
    await screenshot("after-annotation-expanded");
    await messageScreenshot("after-message-annotation-expanded");
    await click(".annotation-card summary");
    await click(
      'a.user-file-reference[title="/fixture/project/global_planner"]',
    );
    await waitFor(
      `document.querySelector('.file-location span')?.title==='/fixture/project/global_planner'`,
    );
    await screenshot("after-folder-open");
    await screenshot("after-folder-detail", workspaceClip);
    await click(
      '.tree-row[title="/fixture/project/global_planner/planner.js"]',
    );
    await waitFor(
      `document.querySelector('.cm-content')?.innerText.includes('hover = true')`,
    );
    assert(
      (
        await evaluate(`document.querySelector('.file-status').innerText`)
      ).includes("/fixture/project/global_planner/planner.js"),
    );
    await screenshot("after-folder-file-open");
    await screenshot("after-folder-file-detail", workspaceClip);
    await click('a.user-file-reference[title="/fixture/project/planner.js"]');
    await waitFor(
      `document.querySelector('.context-workspace[data-open="true"]')`,
    );
    await waitFor(
      `document.querySelector('.cm-content')?.innerText.includes('hover = true')`,
    );
    await screenshot("after-file-open");
    await click('button[title="折叠对话详情"]');
    await click(
      '[data-message-id="annotation-user"] button[title="编辑并重新发送"]',
    );
    assert.equal(
      await evaluate(
        `document.querySelector('textarea[aria-label="消息"]').value`,
      ),
      "也请检查 @planner.js。",
    );
    assert.equal(
      await evaluate(
        `document.querySelectorAll('.annotation-attachment').length`,
      ),
      1,
    );
    assert.equal(
      await evaluate(`document.querySelectorAll('.attachment').length`),
      1,
    );
    await screenshot("after-edit-restored");
    await click('button[title="移除 planner.js"]');
    assert.equal(
      await evaluate(`document.querySelectorAll('.attachment').length`),
      0,
    );
    await click('button[aria-label="打开批注 1"]');
    await fill(".annotation-editor textarea", "核对停留和悬停约束。");
    await click('.annotation-editor button[type="submit"]');
    await key("Enter", 2);
    await waitFor(`!document.querySelector('.annotation-attachment')`);
    const sent = await evaluate(
      `annotationFixture.requests.filter(r=>r.method==='turn/start').at(-1).params.input`,
    );
    assert.equal(sent.length, 1);
    assert(sent[0].text.includes("核对停留和悬停约束。"));
    assert(!(await evaluate(bubble)).includes("# Response annotations:"));
    await screenshot("after-submit");
    await page("Page.reload");
    await waitFor(
      `document.querySelectorAll('.user-file-reference').length===2`,
    );
    assert(!(await evaluate(bubble)).includes("按需读取"));
    await fill('textarea[aria-label="消息"]', "@global");
    await waitFor(`document.querySelector('[role="option"]')`);
    await click('[role="option"]');
    await fill(
      'textarea[aria-label="消息"]',
      "检查 @global_planner 的悬停约束。",
    );
    await click(".send-button");
    await waitFor(
      `document.querySelectorAll('.user-file-reference').length===3`,
    );
    assert(!(await evaluate(bubble)).includes("请根据任务按需读取。"));
    const referenceSent = await evaluate(
      `annotationFixture.requests.filter(r=>r.method==='turn/start').at(-1).params.input`,
    );
    assert(referenceSent[1].text.includes("global_planner"));
    await screenshot("after-reference-submit");
    await page("Page.reload");
    await waitFor(
      `document.querySelectorAll('.user-file-reference').length===2`,
    );
    for (const theme of ["light", "dark"]) {
      await evaluate(`document.documentElement.dataset.theme='${theme}'`);
      await click(
        'a.user-file-reference[title="/fixture/project/global_planner"]',
      );
      await waitFor(
        `document.querySelector('.file-location span')?.title==='/fixture/project/global_planner'`,
      );
      await screenshot(`after-folder-${theme}`);
      await click('button[title="折叠对话详情"]');
      for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
        await evaluate(`document.documentElement.style.zoom=${zoom}`);
        const overflow = await evaluate(
          `document.documentElement.scrollWidth > innerWidth`,
        );
        assert.equal(overflow, false, theme + " zoom " + zoom);
        await screenshot(`after-${theme}-${zoom}`);
      }
    }
    await evaluate(`document.documentElement.style.zoom=1`);
    await evaluate(
      `document.querySelector('a.user-file-reference[title="/fixture/project/global_planner"]').focus()`,
    );
    await key("Enter");
    await waitFor(
      `document.querySelector('.file-location span')?.title==='/fixture/project/global_planner'`,
    );
    await click('button[title="折叠对话详情"]');
    await page("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitFor(
      `document.querySelector('.sidebar').getBoundingClientRect().right<=1`,
    );
    await click(
      'a.user-file-reference[title="/fixture/project/global_planner"]',
    );
    await waitFor(
      `document.querySelector('.file-location span')?.title==='/fixture/project/global_planner'`,
    );
    await screenshot("after-folder-mobile");
    await click(
      '.tree-row[title="/fixture/project/global_planner/planner.js"]',
    );
    await waitFor(
      `document.querySelector('.cm-content')?.innerText.includes('hover = true')`,
    );
    await screenshot("after-file-mobile");
    await click('button[title="折叠对话详情"]');
    await screenshot("after-mobile-dark");
    assert.equal(
      await evaluate(`document.documentElement.scrollWidth > innerWidth`),
      false,
    );
  }
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        passed: true,
        before,
        beforeNavigation: process.env.REFERENCE_NAVIGATION_BEFORE === "1",
        build: buildInfo,
        data: "生产构建；隔离 WebSocket 历史与 Chromium 配置目录",
        scenarios: [
          "目录引用",
          "目录定位与子文件打开",
          "链接键盘激活",
          "批注和文件引用",
          "编辑恢复",
          "批注原文收放",
          "提交",
          "刷新",
          "深浅主题",
          "80% 至 200% 缩放",
          "窄屏",
        ],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, before, output }));
}
