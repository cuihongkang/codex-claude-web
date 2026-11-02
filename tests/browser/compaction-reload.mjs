import assert from "node:assert/strict";

// 分别使用旧桥接与带整理快照的桥接验证完整页面刷新。
export async function testCompactionReload({
  page,
  evaluate,
  waitFor,
  pause,
  click,
  clickText,
  type,
  screenshot,
}) {
  const reload = async () => {
    await evaluate("commandFixture.reloading = true");
    await page("Page.reload", {});
    // 等待新文档的模拟后端和输入框，避免读取刷新前仍存在的 DOM。
    await waitFor(
      `window.commandFixture && !commandFixture.reloading && document.querySelector('textarea[aria-label="消息"]') && document.querySelector('.breadcrumb > span')?.textContent === '核对快捷命令'`,
    );
  };
  const status = () =>
    evaluate(`document.querySelector('.compaction-status')?.textContent || ''`);
  const start = async () => {
    await evaluate("commandFixture.holdCompact(true)");
    await waitFor(`document.querySelector('button[title="对话操作"]')`);
    await click('button[title="对话操作"]');
    await clickText("整理上下文");
    await waitFor(
      `document.querySelector('.compaction-status')?.textContent.includes('正在提交上下文整理')`,
    );
  };
  await evaluate("commandFixture.useLegacy(true)");
  // 重新建连使初始化快照也与旧桥接一致。
  await reload();
  await type("立即刷新后保留的草稿");
  await start();
  const before = await evaluate("commandFixture.compaction()");
  await screenshot("reload-before-start-submitted");
  await reload();
  await screenshot("reload-before-start-restored");
  const restored = await status();
  await evaluate("commandFixture.startCompact()");
  await pause(100);
  const running = await evaluate("commandFixture.compaction()");
  await screenshot("reload-before-start-running");
  console.log(
    JSON.stringify({
      case: "立即刷新",
      backendStatus: running.status,
      restoredStatus: restored,
      currentStatus: await status(),
    }),
  );
  assert.equal(running.status, "running", "刷新后后端继续整理");
  assert(
    restored.includes("正在提交上下文整理"),
    "开始通知前立即刷新仍保留整理提示",
  );
  assert((await status()).includes("正在整理上下文"));
  assert.equal(
    await evaluate(
      `document.querySelector('button[aria-label="发送消息"]').disabled`,
    ),
    true,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="消息"]').value`,
    ),
    "立即刷新后保留的草稿",
  );

  // 开始通知已在刷新前发出，刷新后只能通过持久任务与后端记录恢复。
  await reload();
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('正在整理上下文')`,
  );
  await screenshot("reload-running-restored");
  await evaluate("commandFixture.finishCompact()");
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('上下文整理完成')`,
  );
  await screenshot("reload-completed");
  assert.equal(
    await evaluate(
      `document.querySelector('button[aria-label="发送消息"]').disabled`,
    ),
    false,
  );
  await click('button[title="关闭整理状态"]');
  await reload();
  assert.equal(await status(), "", "已结束任务清理持久占用，刷新后保持关闭");
  for (const [result, title] of [
    ["completed", "上下文整理完成"],
    ["failed", "上下文整理失败"],
    ["interrupted", "上下文整理已中断"],
  ]) {
    await start();
    await evaluate("commandFixture.startCompact()");
    await evaluate(`commandFixture.finishOnReload(${JSON.stringify(result)})`);
    await reload();
    await waitFor(
      `document.querySelector('.compaction-status')?.textContent.includes(${JSON.stringify(title)})`,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('button[aria-label="发送消息"]').disabled`,
      ),
      false,
    );
    assert.deepEqual(
      await evaluate(`JSON.parse(localStorage.getItem('cx-compactions'))`),
      {},
      "结果确认后清理持久任务",
    );
    await screenshot("reload-finished-during-" + result);
    await click('button[title="关闭整理状态"]');
  }
  await evaluate("commandFixture.useLegacy(false)");
  await reload();
  assert.equal(await status(), "", "现代桥接的旧结果快照保持提示关闭");
  await start();
  await evaluate("commandFixture.startCompact()");
  await evaluate("commandFixture.finishCompact()");
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('上下文整理完成')`,
  );
  await reload();
  assert.equal(await status(), "", "已显示完成结果在重新加载后保持收起");
  await start();
  await evaluate("commandFixture.startCompact()");
  await evaluate("commandFixture.finishCompact()");
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('上下文整理完成')`,
  );
  await click('button[title="在当前目录新建对话"]');
  await click('.project-heading > button[title="/fixture/project"]');
  await click(".thread-link");
  await waitFor(
    `document.querySelector('.breadcrumb > span')?.textContent === '核对快捷命令' && document.querySelector('textarea[aria-label="消息"]')`,
  );
  assert.equal(await status(), "", "切换对话再返回保持提示关闭");
  await reload();
  assert.equal(await status(), "", "完整刷新后旧结果快照保持提示关闭");
  await screenshot("reload-modern-completed-hidden");
  await start();
  await evaluate("commandFixture.startCompact()");
  await evaluate("commandFixture.finishOnReload('completed')");
  await reload();
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('上下文整理完成')`,
  );
  await click('button[title="关闭整理状态"]');
  await reload();
  assert.equal(await status(), "", "手动关闭后旧结果快照保持提示关闭");
  await type("");
  return { submitted: before.status, running: running.status, restored };
}
