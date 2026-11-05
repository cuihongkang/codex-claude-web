import assert from "node:assert/strict";

export async function testSidebarDensity({
  page,
  evaluate,
  click,
  waitFor,
  screenshot,
  pause,
  server,
  evidence,
  before,
}) {
  const heading = (path) =>
    `.project-heading > button[title="${path || "未指定项目的对话"}"]`;
  const group = (path) => `.project-group:has(${heading(path)})`;
  const rows = (path) =>
    evaluate(
      `document.querySelectorAll(${JSON.stringify(group(path) + " .thread-row")}).length`,
    );
  const opened = (path) =>
    evaluate(
      `document.querySelector(${JSON.stringify(heading(path))}).getAttribute('aria-expanded')`,
    );
  const url = "http://127.0.0.1:" + server.address().port;
  const ready = () =>
    waitFor(
      "document.querySelectorAll('.project-heading').length===3 && document.querySelector('[aria-label=消息]') && !document.querySelector('[aria-label=消息]').disabled",
    );
  const capture = async (name) => {
    await page("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 900,
      y: 600,
    });
    await pause(300);
    const layout = await evaluate(
      "({overflow:document.documentElement.scrollWidth>innerWidth,groups:[...document.querySelectorAll('.project-group:has(.project-heading)')].map(g=>({title:g.querySelector('.project-heading > button').title,expanded:g.querySelector('.project-heading > button').getAttribute('aria-expanded'),rows:g.querySelectorAll('.thread-row').length,more:g.querySelector('.project-more')?.textContent}))})",
    );
    assert(!layout.overflow);
    evidence.push({ name, ...layout });
    await screenshot(name);
    if (name === "desktop-default")
      await screenshot(name + "-sidebar", undefined, {
        x: 0,
        y: 185,
        width: 240,
        height: 400,
        scale: 1,
      });
  };
  await page("Page.enable", {});
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1200,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.navigate", { url });
  await ready();
  if (before) {
    assert((await rows("/demo/Atlas")) > 5);
    assert((await rows("/demo/Beacon")) > 0);
    await capture("desktop-default");
    return;
  }
  const paths = () =>
    evaluate(
      "[...document.querySelectorAll('.project-heading > button:first-child')].map(e=>e.title)",
    );
  assert.equal(
    (await paths()).at(-1),
    "未指定项目的对话",
    "最近活动的未分类仍位于最下面",
  );
  assert.equal(await opened("/demo/Atlas"), "true");
  assert.equal(await rows("/demo/Atlas"), 5);
  assert.equal(await opened("/demo/Beacon"), "false");
  assert.equal(await rows("/demo/Beacon"), 0);
  assert.equal(await opened(""), "false");
  assert.equal(await rows(""), 0);
  const titles = await evaluate(
    `[...document.querySelectorAll(${JSON.stringify(group("/demo/Atlas") + " .thread-link > span")})].map(e=>e.textContent)`,
  );
  assert.deepEqual(titles, [
    "完善快速开始文档",
    "检查项目结构",
    "Atlas 历史对话 1",
    "Atlas 历史对话 2",
    "Atlas 历史对话 3",
  ]);
  assert(
    await evaluate(
      "pinRequests.filter(m=>m.method==='thread/list').some(m=>m.params.cursor==='density-next')",
    ),
    "读取后端全部分页",
  );
  await capture("desktop-default");
  await click('[aria-label="查看更多 Atlas 的对话"]');
  assert.equal(
    await rows("/demo/Atlas"),
    67,
    "查看更多包含全局第 60 条之后的对话",
  );
  assert.equal(await rows("/demo/Beacon"), 0, "各文件夹独立展开");
  await capture("desktop-show-all");
  await click(group("/demo/Atlas") + " .thread-row:last-of-type .thread-link");
  await waitFor(
    "pinRequests.some(m=>m.method==='thread/read' && m.params.threadId==='atlas-old-64') && document.querySelector('[aria-label=消息]') && !document.querySelector('[aria-label=消息]').disabled",
  );
  await click('[aria-label="收起 Atlas 的对话"]');
  assert.equal(await rows("/demo/Atlas"), 5);
  await click(heading("/demo/Beacon"));
  assert.equal(await rows("/demo/Beacon"), 5);
  await click('[aria-label="查看更多 Beacon 的对话"]');
  assert.equal(await rows("/demo/Beacon"), 8);
  await click(heading("/demo/Atlas"));
  assert.equal(await rows("/demo/Atlas"), 0);
  await click(heading(""));
  assert.equal(await rows(""), 1);
  await page("Page.reload", {});
  await ready();
  assert.equal(await rows("/demo/Atlas"), 5, "刷新恢复固定默认展开及五条限制");
  assert.equal(await rows("/demo/Beacon"), 0, "刷新恢复未固定默认折叠");
  assert.equal(await rows(""), 0);
  await evaluate("localStorage.setItem('cx-theme',JSON.stringify('dark'))");
  await page("Page.reload", {});
  await ready();
  await capture("desktop-dark");
  await click('[aria-label="查看更多 Atlas 的对话"]');
  await evaluate(
    "document.querySelector('[aria-label=\"收起 Atlas 的对话\"]').focus()",
  );
  for (const type of ["keyDown", "keyUp"])
    await page("Input.dispatchKeyEvent", {
      type,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      ...(type === "keyDown" ? { text: "\r" } : {}),
    });
  assert.equal(await rows("/demo/Atlas"), 5);
  await evaluate("localStorage.setItem('cx-theme',JSON.stringify('light'))");
  await page("Page.reload", {});
  await ready();
  for (const scale of [0.8, 1, 1.25, 1.5, 2]) {
    await evaluate(`document.documentElement.style.zoom=${scale}`);
    await pause(100);
    assert.equal(await rows("/demo/Atlas"), 5);
    assert.equal(await rows("/demo/Beacon"), 0);
    assert(
      !(await evaluate("document.documentElement.scrollWidth>innerWidth")),
    );
  }
  await evaluate("document.documentElement.style.zoom=1");
  await page("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await page("Emulation.setTouchEmulationEnabled", { enabled: true });
  await click('.topbar button[title="显示侧栏"]');
  await waitFor("document.querySelector('.sidebar.mobile-open')");
  await capture("mobile-default");
  await click('[aria-label="查看更多 Atlas 的对话"]');
  assert.equal(await rows("/demo/Atlas"), 67);
  await click('[aria-label="收起 Atlas 的对话"]');
  assert.equal(await rows("/demo/Atlas"), 5);
  await capture("mobile-restored");
}
