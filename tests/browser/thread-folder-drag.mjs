import { testThreadFolderZoom } from "./thread-folder-zoom.mjs";
import assert from "node:assert/strict";

export async function testThreadFolderDragBrowser({
  call,
  page,
  evaluate,
  click,
  waitFor,
  screenshot,
  server,
  ws,
}) {
  await page("Page.enable", {});
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1200,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.navigate", {
    url: `http://127.0.0.1:${server.address().port}/`,
  });
  await waitFor("document.querySelectorAll('.project-heading').length===3");
  await click('.project-heading > button[title="/demo/Atlas"]');
  const atlas = '.project-group:has(button[title="/demo/Atlas"])';
  const beacon = '.project-heading:has(button[title="/demo/Beacon"])';
  const position = (selector) =>
    evaluate(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
  let data;
  for (const backend of ["codex", "claude"]) {
    await page("Input.setInterceptDrags", { enabled: true });
    const drag = Promise.withResolvers();
    const listener = (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Input.dragIntercepted")
        drag.resolve(message.params.data);
    };
    ws.addEventListener("message", listener);
    const from = await position(
      atlas + ` .thread-link:has([data-backend="${backend}"])`,
    );
    const to = await position(beacon);
    await page("Input.dispatchMouseEvent", { type: "mouseMoved", ...from });
    await page("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      buttons: 1,
      clickCount: 1,
      ...from,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await page("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      button: "left",
      buttons: 1,
      x: from.x + 15,
      y: from.y + 15,
    });
    await page("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      buttons: 1,
      ...to,
    });
    data = await Promise.race([
      drag.promise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("浏览器未启动对话拖拽 " + backend)),
          5000,
        ),
      ),
    ]);
    ws.removeEventListener("message", listener);
    assert.equal(data.items[0].mimeType, "application/x-claudex-thread");
    await page("Input.dispatchDragEvent", { type: "dragEnter", ...to, data });
    await page("Input.dispatchDragEvent", { type: "dragOver", ...to, data });
    await waitFor("document.querySelector('.project-heading.drop-target')");
    await screenshot("folder-drop-target");
    await page("Input.dispatchDragEvent", { type: "drop", ...to, data });
    await page("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      buttons: 0,
      clickCount: 1,
      ...to,
    });
    await waitFor("window.pinRequests.some(r=>r.method==='lan/thread/move')");
    await waitFor(
      "document.querySelector('button[title=\"/demo/Beacon\"]').getAttribute('aria-expanded')==='true'",
    );
    assert.equal(
      await evaluate(
        "window.pinRequests.find(r=>r.method==='lan/thread/move').params.folderPath",
      ),
      "/demo/Beacon",
    );
    const id = data.items[0].data;
    assert.equal(
      await evaluate(
        `JSON.parse(localStorage.getItem('fixture-folders'))[${JSON.stringify(id)}].folderPath`,
      ),
      "/demo/Beacon",
    );
  }
  for (const theme of ["dark", "light"]) {
    await evaluate(
      `localStorage.setItem('cx-theme',JSON.stringify(${JSON.stringify(theme)}))`,
    );
    await page("Page.reload", {});
    await waitFor("document.querySelector('button[title=\"/demo/Beacon\"]')");
    await click('.project-heading > button[title="/demo/Beacon"]');
    await waitFor(
      "document.querySelectorAll('.project-group:has(button[title=\"/demo/Beacon\"]) .thread-link').length===3",
    );
    await screenshot("folder-moved-" + theme);
  }
  const unclassified = await position(
    '.project-heading:has(button[title="未指定项目的对话"])',
  );
  await page("Input.dispatchDragEvent", {
    type: "dragEnter",
    ...unclassified,
    data,
  });
  await page("Input.dispatchDragEvent", {
    type: "drop",
    ...unclassified,
    data,
  });
  await waitFor(
    "document.querySelectorAll('.project-group:has(button[title=\"未指定项目的对话\"]) .thread-link').length===1",
  );
  await screenshot("folder-unclassified");
  await testThreadFolderZoom({
    call,
    page,
    evaluate,
    waitFor,
    click,
    screenshot,
  });
  await page("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await click('.topbar button[title="显示侧栏"]');
  assert.equal(
    await evaluate("document.documentElement.scrollWidth > innerWidth"),
    false,
  );
  await screenshot("folder-mobile");
  console.log(
    "PASS real browser dragstart, target feedback, Codex/Claude persisted moves, refresh, dark/light and unclassified",
  );
}
