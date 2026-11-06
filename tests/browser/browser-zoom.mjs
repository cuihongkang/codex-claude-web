import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function testBrowserZoom({ context, page, artifacts }) {
  await mkdir(artifacts, { recursive: true });
  const settings = await context.newPage();
  await settings.goto("chrome://settings/appearance");
  const zoom = settings.locator("#zoomLevel");
  await zoom.waitFor();
  const results = [];
  try {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        for (const scale of [0.8, 1, 1.25, 1.5, 2]) {
          await zoom.selectOption(String(scale));
          await page.reload();
          await page.locator(".markdown-composer .ProseMirror").waitFor();
          await page.evaluate((theme) => {
            document.documentElement.dataset.theme = theme;
          }, theme);
          const editor = page.locator(".markdown-composer .ProseMirror");
          await editor.fill("实际缩放第一行\n第二行");
          assert.match(await editor.innerText(), /第二行/);
          const metrics = await page.evaluate(() => {
            const input = document.querySelector(
              ".markdown-composer .ProseMirror",
            );
            const style = getComputedStyle(input);
            const bounds = input.getBoundingClientRect();
            const welcome = document.querySelector(".welcome");
            return {
              dpr: devicePixelRatio,
              innerWidth,
              innerHeight,
              cssZoom: getComputedStyle(document.documentElement).zoom,
              scrollWidth: document.documentElement.scrollWidth,
              input: {
                left: bounds.left,
                right: bounds.right,
                top: bounds.top,
                bottom: bounds.bottom,
                width: bounds.width,
                height: bounds.height,
              },
              fontSize: parseFloat(style.fontSize),
              lineHeight: parseFloat(style.lineHeight),
              welcome: {
                clientHeight: welcome.clientHeight,
                scrollHeight: welcome.scrollHeight,
                minHeight: getComputedStyle(welcome).minHeight,
                overflow: getComputedStyle(welcome).overflow,
                right: welcome.getBoundingClientRect().right,
              },
              toolsLeft: document
                .querySelector(".context-tools")
                .getBoundingClientRect().left,
              sidebar: {
                position: getComputedStyle(document.querySelector(".sidebar"))
                  .position,
                visibility: getComputedStyle(document.querySelector(".sidebar"))
                  .visibility,
              },
              controls: [
                ...document.querySelectorAll(
                  ".composer-toolbar button, .composer-toolbar select",
                ),
              ]
                .map((element) => {
                  const box = element.getBoundingClientRect();
                  return {
                    name: element.getAttribute("aria-label") || element.title,
                    left: box.left,
                    right: box.right,
                    bottom: box.bottom,
                    width: box.width,
                    height: box.height,
                  };
                })
                .filter((box) => box.width > 0 && box.height > 0),
            };
          });
          const result = { width, theme, scale, ...metrics };
          results.push(result);
          await page.screenshot({
            path: join(artifacts, `${width}-${theme}-${scale}.png`),
            animations: "disabled",
          });
          assert.ok(
            Math.abs(metrics.dpr - scale) < 0.02,
            JSON.stringify(result),
          );
          assert.ok(
            Math.abs(metrics.innerWidth - width / scale) <= 1,
            JSON.stringify(result),
          );
          assert.equal(metrics.cssZoom, "1");
          assert.ok(
            metrics.input.left >= -1 &&
              metrics.input.right <= metrics.innerWidth + 1,
            JSON.stringify(result),
          );
          assert.ok(
            metrics.input.top >= 0 &&
              metrics.input.bottom <= metrics.innerHeight + 1,
            JSON.stringify(result),
          );
          assert.ok(
            metrics.input.height >= metrics.lineHeight * 2 - 2,
            JSON.stringify(result),
          );
          assert.ok(
            metrics.lineHeight / metrics.fontSize >= 1.2,
            JSON.stringify(result),
          );
          for (const control of metrics.controls)
            assert.ok(
              control.left >= -1 &&
                control.right <= metrics.innerWidth + 1 &&
                control.bottom <= metrics.innerHeight + 1,
              JSON.stringify({ ...result, control }),
            );
          assert.ok(
            metrics.welcome.right <= metrics.toolsLeft + 1,
            JSON.stringify(result),
          );
          if (metrics.welcome.scrollHeight > metrics.welcome.clientHeight) {
            const scrolled = await page
              .locator(".welcome")
              .evaluate((element) => {
                element.scrollTop = element.scrollHeight;
                return element.scrollTop;
              });
            assert.ok(scrolled > 0);
          }
          if (metrics.sidebar.position === "fixed") {
            assert.equal(metrics.sidebar.visibility, "hidden");
            await page
              .getByRole("button", { name: "显示侧栏", exact: true })
              .click();
            const close = page.getByRole("button", {
              name: "收起侧栏",
              exact: true,
            });
            await close.waitFor();
            await page.waitForFunction(
              () =>
                document
                  .querySelector(".sidebar.mobile-open")
                  ?.getBoundingClientRect().left >= -1,
            );
            const box = await close.boundingBox();
            assert.ok(
              box.x >= 0 && box.x + box.width <= metrics.innerWidth + 1,
              JSON.stringify({ width, scale, box }),
            );
            await close.click();
            await page.locator(".sidebar").waitFor({ state: "hidden" });
          }
        }
      }
    }
    const report = {
      browserPageZoom: true,
      source: "chrome://settings/appearance #zoomLevel",
      modelTurns: 0,
      results,
    };
    await writeFile(
      join(artifacts, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    return report;
  } finally {
    await zoom.selectOption("1");
    await settings.close();
  }
}
