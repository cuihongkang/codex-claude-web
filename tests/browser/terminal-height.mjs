import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyTerminalHeight({ page, panel, output, requests }) {
  const before = process.env.TERMINAL_HEIGHT_BEFORE === "1";
  const height = () =>
    panel.evaluate((node) => node.getBoundingClientRect().height);
  const initial = await height();
  const box = await panel.boundingBox();
  const creates = requests.filter(
    (request) => request.method === "lan/terminal/create",
  ).length;
  const resizes = requests.filter(
    (request) => request.method === "lan/terminal/resize",
  ).length;
  await page.mouse.move(box.x + box.width / 2, box.y + 1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 100, { steps: 6 });
  await page.mouse.up();
  if (before) {
    assert.equal(await height(), initial);
    await page.screenshot({ path: join(output, "height-before.png") });
    return;
  }
  const handle = page.getByRole("separator", {
    name: "调整终端面板高度",
    exact: true,
  });
  assert((await height()) > initial + 90);

  assert(
    requests.filter((request) => request.method === "lan/terminal/resize")
      .length > resizes,
  );
  const editor = page.locator(".markdown-composer .ProseMirror");
  await editor.fill("第一行\n第二行");
  const visibleComposer = async () => {
    const metrics = await panel.evaluate((node) => {
      const footer = document
        .querySelector(".conversation-footer")
        .getBoundingClientRect();
      const terminal = node.getBoundingClientRect();
      return {
        footerBottom: footer.bottom,
        terminalTop: terminal.top,
        footerTop: footer.top,
      };
    });
    assert(metrics.footerTop >= 0);
    assert(metrics.footerBottom <= metrics.terminalTop + 1);
  };
  await visibleComposer();
  await page.screenshot({ path: join(output, "height-expanded.png") });
  const preferred = await height();
  await page.getByTitle("隐藏终端", { exact: true }).click();
  await page.keyboard.press("Control+Backquote");
  await panel.waitFor();
  assert(Math.abs((await height()) - preferred) < 1);
  await handle.focus();
  await page.keyboard.press("ArrowUp");
  assert((await height()) > preferred + 5);
  await page.keyboard.press("Home");
  const min = Number(await handle.getAttribute("aria-valuemin"));
  assert(Math.abs((await height()) - min) < 1);
  await page.keyboard.press("End");
  const max = Number(await handle.getAttribute("aria-valuemax"));
  assert(Math.abs((await height()) - max) < 1);
  await visibleComposer();
  await handle.dblclick();
  assert(Math.abs((await height()) - initial) < 1);
  const edge = await handle.boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2, edge.y - 40, { steps: 3 });
  await page.keyboard.press("Control+Backquote");
  await page.waitForFunction(
    () => !document.body.classList.contains("terminal-height-resizing"),
  );
  await page.mouse.up();
  await page.keyboard.press("Control+Backquote");
  await panel.waitFor();
  assert((await height()) > initial + 30);
  await page.reload();
  await page.locator(".markdown-composer .ProseMirror").waitFor();
  await page.keyboard.press("Control+Backquote");
  await panel.waitFor();
  assert((await height()) > initial + 30);
  await handle.dblclick();
  assert.equal(
    requests.filter((request) => request.method === "lan/terminal/create")
      .length,
    creates,
  );
  await page.screenshot({ path: join(output, "height-reset.png") });
}
