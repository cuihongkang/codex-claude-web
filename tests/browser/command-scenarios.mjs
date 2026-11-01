import assert from "node:assert/strict";
export async function runCommandScenarios({
  page,
  call,
  targetId,
  evaluate,
  waitFor,
  pause,
  click,
  clickText,
  type,
  submit,
  close,
  screenshot,
  beforeDismiss,
}) {
  await type("/");
  const expectedCommands = [
    "init",
    "new",
    "model",
    "plan",
    "review",
    "compact",
    "goal",
    "skills",
    "files",
    "diff",
    "terminal",
    "stop",
    "project",
    "search",
    "status",
    "fork",
    "rename",
    "delete",
  ];
  assert.deepEqual(
    await evaluate(
      `[...document.querySelectorAll('[role="option"] b')].map(e=>e.textContent.slice(1)).sort()`,
    ),
    expectedCommands.sort(),
  );
  await screenshot("retained-command-menu");
  for (const removed of ["resume", "ps", "clean", "side", "export", "fast"]) {
    await type("/" + removed);
    assert.equal(
      await evaluate(`document.querySelectorAll('[role="option"]').length`),
      0,
    );
  }
  await submit("/resume");
  await waitFor(
    `document.querySelector('.error-banner')?.textContent.includes('未识别的命令 /resume')`,
  );
  assert.equal(
    await evaluate(`commandFixture.requests.some(r=>r.method==='turn/start')`),
    false,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="消息"]').value`,
    ),
    "/resume",
  );
  await screenshot("removed-resume");
  await click('button[title="关闭错误提示"]');
  await type("/in");
  await waitFor(
    `document.querySelector('[role="option"]')?.textContent.includes('/init')`,
  );
  await screenshot("init-menu");
  await click('[role="option"]');
  await waitFor(`document.body.textContent.includes('保留已有项目约定')`);
  assert.equal(
    await evaluate(
      `commandFixture.requests.filter(r=>r.method==='turn/start').length`,
    ),
    0,
  );
  await screenshot("init-existing");
  await evaluate(
    `commandFixture.files.delete('/fixture/project/AGENTS.md');commandFixture.setFail(true)`,
  );
  await submit("/init");
  await waitFor(
    `document.querySelector('.error-banner')?.textContent.includes('模拟提交失败')`,
  );
  assert.equal(
    await evaluate(`!!document.querySelector('[role="listbox"]')`),
    false,
    "提交后收起建议层，错误提示保持可见",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="消息"]').value`,
    ),
    "/init",
  );
  await screenshot("init-retry");
  await evaluate(`commandFixture.setFail(false)`);
  await click('button[aria-label="发送消息"]');
  await waitFor(`document.body.textContent.includes('已生成 AGENTS.md')`);
  await submit("/goal 完成命令对照与回归验证");
  await waitFor(
    `document.querySelector('[role="dialog"]')?.textContent.includes('保存并开始')`,
  );
  await screenshot("goal-light");
  await clickText("暂停目标");
  await waitFor(
    `document.querySelector('[role="dialog"]')?.textContent.includes('已暂停')`,
  );
  await clickText("恢复目标");
  await waitFor(
    `document.querySelector('[role="dialog"]')?.textContent.includes('进行中')`,
  );
  for (const [selector, text] of [
    ['[role="dialog"] textarea', "完成三项保留命令的验证"],
    ['[role="dialog"] input[type="number"]', "5000"],
  ]) {
    await click(selector);
    await page("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      modifiers: 2,
      commands: ["selectAll"],
    });
    await page("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      modifiers: 2,
    });
    await page("Input.insertText", { text });
  }
  await clickText("保存并开始");
  await waitFor(
    `commandFixture.requests.some(r=>r.method==='thread/goal/set'&&r.params.objective==='完成三项保留命令的验证'&&r.params.tokenBudget===5000&&r.params.origin==='user')`,
  );
  await close();
  await submit("/stop");
  await waitFor(
    `document.querySelector('[role="dialog"]')?.textContent.includes('npm run dev')`,
  );
  await screenshot("background-terminals");
  await clickText("停止全部后台终端");
  await waitFor(
    `document.querySelector('[role="dialog"]')?.textContent.includes('没有后台终端')`,
  );
  await screenshot("background-terminals-cleaned");
  assert.equal(
    await evaluate(
      `commandFixture.requests.some(r=>r.method==='thread/backgroundTerminals/clean')`,
    ),
    true,
  );
  await close();
  assert.equal(
    await evaluate(
      `commandFixture.requests.some(r=>r.method==='turn/interrupt')`,
    ),
    false,
  );
  const layouts = [];
  for (const theme of ["light", "dark"]) {
    for (const width of [1440, 390]) {
      await page("Emulation.setDeviceMetricsOverride", {
        width,
        height: width === 390 ? 844 : 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate(
        `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
      );
      await pause(350);
      await submit("/goal");
      await waitFor(
        `document.querySelector('[role="dialog"]')?.textContent.includes('保存并开始')`,
      );
      const bounds = await evaluate(
        `(()=>{const e=document.querySelector('[role="dialog"]'),r=e.getBoundingClientRect();return{left:r.left,right:r.right,bottom:r.bottom,viewport:innerWidth,scroll:document.documentElement.scrollWidth,inputs:[...e.querySelectorAll('input,textarea,button')].map(e=>({label:e.getAttribute('aria-label')||e.textContent.trim(),color:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor}))}})()`,
      );
      assert(
        bounds.left >= 0 &&
          bounds.right <= bounds.viewport + 1 &&
          bounds.scroll <= bounds.viewport,
      );
      layouts.push({ theme, width, ...bounds });
      await screenshot(`goal-${theme}-${width}`);
      await close();
    }
  }
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(
    'document.documentElement.dataset.theme="light";commandFixture.holdCompact(true)',
  );
  await pause(350);
  await submit("/compact");
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('正在提交上下文整理')`,
  );
  await screenshot("compact-submitting");
  await type("整理期间保留的草稿");
  const writesBefore = await evaluate(
    `commandFixture.requests.filter(r=>r.method==='turn/start'||r.method==='turn/steer').length`,
  );
  await page("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    modifiers: 2,
  });
  await page("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    modifiers: 2,
  });
  assert.equal(
    await evaluate(
      `document.querySelector('button[aria-label="发送消息"]').disabled`,
    ),
    true,
  );
  await click('button[aria-label="发送消息"]');
  await evaluate("commandFixture.acknowledgeCompact()");
  await pause(100);
  assert.equal(
    await evaluate(
      `document.querySelector('button[aria-label="发送消息"]').disabled`,
    ),
    true,
  );
  await evaluate("commandFixture.startCompact()");
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('正在整理上下文')`,
  );
  const elapsedBefore = await evaluate(
    `document.querySelector('.compaction-status time').textContent`,
  );
  await pause(1200);
  assert.notEqual(
    await evaluate(
      `document.querySelector('.compaction-status time').textContent`,
    ),
    elapsedBefore,
  );
  assert.equal(
    await evaluate(
      `commandFixture.requests.filter(r=>r.method==='turn/start'||r.method==='turn/steer').length`,
    ),
    writesBefore,
  );
  await screenshot("compact-running");
  await page("Page.reload", {});
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('正在整理上下文')&&document.querySelector('textarea[aria-label="消息"]')`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="消息"]').value`,
    ),
    "整理期间保留的草稿",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('button[aria-label="发送消息"]').disabled`,
    ),
    true,
  );
  await screenshot("compact-reloaded");
  await page("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate('document.documentElement.dataset.theme="dark"');
  await pause(350);
  await screenshot("compact-running-dark-390");
  await evaluate("commandFixture.finishCompact()");
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('上下文整理完成')`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('button[aria-label="发送消息"]').disabled`,
    ),
    false,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="消息"]').value`,
    ),
    "整理期间保留的草稿",
  );
  await screenshot("compact-completed-dark-390");
  const completedLayout = await evaluate(`(()=>{
    const title=document.querySelector('.compaction-status strong').getBoundingClientRect();
    const close=document.querySelector('button[title="关闭整理状态"]').getBoundingClientRect();
    return {titleTop:title.top,closeTop:close.top,scrollWidth:document.documentElement.scrollWidth,width:innerWidth};
  })()`);
  assert(Math.abs(completedLayout.titleTop - completedLayout.closeTop) < 20);
  assert(completedLayout.scrollWidth <= completedLayout.width);
  await click('button[aria-label="发送消息"]');
  await waitFor(
    `document.querySelector('textarea[aria-label="消息"]').value === ''`,
  );
  await screenshot("compact-after-send-button-dark-390");
  assert.equal(
    await evaluate(`!!document.querySelector('.compaction-status')`),
    beforeDismiss,
    "发送按钮提交新消息后自动关闭整理完成提示",
  );
  if (beforeDismiss) await click('button[title="关闭整理状态"]');
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate('document.documentElement.dataset.theme="light"');
  await pause(350);
  await submit("/compact");
  await evaluate("commandFixture.startCompact()");
  await type("失败后继续保留的草稿");
  await evaluate('commandFixture.finishCompact("failed")');
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('模拟整理失败')`,
  );
  await screenshot("compact-failed");
  await clickText("重新整理");
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('正在提交上下文整理')`,
  );
  await evaluate(
    "commandFixture.startCompact();commandFixture.finishCompact()",
  );
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('上下文整理完成')`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="消息"]').value`,
    ),
    "失败后继续保留的草稿",
  );
  await screenshot("compact-retried-completed");
  await submit("整理完成后通过快捷键继续对话");
  await waitFor(
    `document.querySelector('textarea[aria-label="消息"]').value === ''`,
  );
  await screenshot("compact-after-send-keyboard-light-1440");
  assert.equal(
    await evaluate(`!!document.querySelector('.compaction-status')`),
    beforeDismiss,
    "Ctrl+Enter 提交新消息后自动关闭整理完成提示",
  );
  if (beforeDismiss) await click('button[title="关闭整理状态"]');
  await evaluate("commandFixture.holdCompact(false)");
  await submit("/compact");
  await evaluate("commandFixture.startCompact()");
  await type("后台断线后继续编辑的草稿");
  assert.equal(
    await evaluate("document.querySelector('.compaction-status p') === null"),
    true,
  );
  const background = await call("Target.createTarget", { url: "about:blank" });
  await call("Target.activateTarget", { targetId: background.targetId });
  await waitFor("document.visibilityState === 'hidden'");
  const checkCount = await evaluate(
    `commandFixture.requests.filter(request => request.method === 'lan/compaction/check').length`,
  );
  await evaluate("commandFixture.disconnect()");
  await screenshot("compact-reconnecting");
  await evaluate("commandFixture.finishCompact()");
  await call("Target.activateTarget", { targetId });
  await page("Page.bringToFront", {});
  await waitFor("document.visibilityState === 'visible'");
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('上下文整理完成') && document.querySelector('button[aria-label="发送消息"]')?.disabled === false`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="消息"]').value`,
    ),
    "后台断线后继续编辑的草稿",
  );
  assert.equal(
    await evaluate(
      `commandFixture.requests.filter(request => request.method === 'lan/compaction/check').length`,
    ),
    checkCount,
    "旧桥接不依赖新增状态接口",
  );
  await screenshot("compact-background-recovered");
  await call("Target.closeTarget", { targetId: background.targetId });
  await page("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate('document.documentElement.dataset.theme="dark"');
  await pause(350);
  await screenshot("compact-background-recovered-dark-390");

  return layouts;
}
