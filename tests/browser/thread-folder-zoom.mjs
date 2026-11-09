import assert from "node:assert/strict";

export async function testThreadFolderZoom({
  call,
  page,
  evaluate,
  waitFor,
  click,
  screenshot,
}) {
  const { targetId } = await call("Target.createTarget", {
    url: "chrome://settings/appearance",
  });
  const { sessionId } = await call("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const settings = async (expression) => {
    const response = await call(
      "Runtime.evaluate",
      { expression, returnByValue: true },
      sessionId,
    );
    if (response.exceptionDetails)
      throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const select = `(()=>{const roots=[document];while(roots.length){const root=roots.pop();const select=root.querySelector('#zoomLevel');if(select)return select;for(const e of root.querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot)}return null})()`;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await settings(`Boolean(${select})`)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(await settings(`Boolean(${select})`), true);
    for (const scale of [0.8, 1, 1.25, 1.5, 2]) {
      await settings(
        `(()=>{const e=${select};e.value=${JSON.stringify(String(scale))};e.dispatchEvent(new Event('change',{bubbles:true,composed:true}));return e.value})()`,
      );
      await page("Page.bringToFront", {});
      await page("Page.reload", {});
      await waitFor("document.querySelector('button[title=\"/demo/Beacon\"]')");
      const metrics = await evaluate(
        "({dpr:devicePixelRatio,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth})",
      );
      assert.ok(
        Math.abs(metrics.dpr - scale) < 0.02,
        JSON.stringify({ scale, metrics }),
      );
      const hidden = await evaluate(
        "getComputedStyle(document.querySelector('.sidebar')).visibility==='hidden'",
      );
      if (hidden) await click('.topbar button[title="显示侧栏"]');
      await waitFor(
        "document.querySelector('.project-heading:has(button[title=\"/demo/Beacon\"])').getBoundingClientRect().left>=0",
      );
      const bounds = await evaluate(
        "(()=>{const r=document.querySelector('.project-heading:has(button[title=\"/demo/Beacon\"])').getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}})()",
      );
      assert.ok(
        bounds.left >= 0 && bounds.right <= bounds.width,
        JSON.stringify(bounds),
      );
      assert.equal(metrics.overflow, false);
      await screenshot("folder-browser-zoom-" + scale);
      if (hidden) await click('[aria-label="收起侧栏"]');
    }
  } finally {
    await settings(
      `(()=>{const e=${select};e.value='1';e.dispatchEvent(new Event('change',{bubbles:true,composed:true}))})()`,
    );
    await call("Target.closeTarget", { targetId });
    await page("Page.bringToFront", {});
    await page("Page.reload", {});
    await waitFor("document.querySelector('button[title=\"/demo/Beacon\"]')");
  }
}
