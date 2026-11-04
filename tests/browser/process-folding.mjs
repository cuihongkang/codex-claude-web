import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";
import { browserDriver } from "../helpers/browser-driver.mjs";
import { providerFixture } from "../fixtures/providers.mjs";
import { serveDemoSession } from "../helpers/browser-session.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const build = join(
  root,
  before ? ".cache/process-folding-before/dist" : "client/dist",
);
const output = join(
  root,
  ".cache/process-folding-browser",
  before ? "before" : "after",
);
await mkdir(output, { recursive: true });
const translations = [];
let releaseTranslation;
function historyFixture() {
  const records = [
    {
      item: {
        id: "old-user",
        type: "userMessage",
        content: [{ type: "text", text: "介绍这个项目。" }],
      },
      turnId: "old-turn",
    },
    {
      item: {
        id: "old-thought",
        type: "reasoning",
        content: ["上一轮思考正文。"],
      },
      turnId: "old-turn",
    },
    {
      item: {
        id: "old-progress",
        type: "agentMessage",
        text: "上一轮中途回复。",
      },
      turnId: "old-turn",
    },
    {
      item: {
        id: "old-answer",
        type: "agentMessage",
        text: "上一轮最终回答。",
      },
      turnId: "old-turn",
    },
  ];
  localStorage.setItem(
    "fold-records",
    localStorage.getItem("fold-records") || JSON.stringify(records),
  );
  localStorage.setItem(
    "fold-turns",
    localStorage.getItem("fold-turns") ||
      JSON.stringify([{ id: "old-turn", status: "completed" }]),
  );
  const Base = window.WebSocket;
  window.WebSocket = class extends Base {
    send(raw) {
      const m = JSON.parse(raw);
      if (!["thread/items/list", "thread/turns/list"].includes(m.method))
        return super.send(raw);
      const data = JSON.parse(
        localStorage.getItem(
          m.method === "thread/items/list" ? "fold-records" : "fold-turns",
        ),
      );
      setTimeout(
        () =>
          this.onmessage?.({
            data: JSON.stringify({
              id: m.id,
              result: {
                data:
                  m.params.sortDirection === "asc" ? data : data.toReversed(),
                nextCursor: null,
              },
            }),
          }),
        5,
      );
    }
  };
}
const server = createServer(async (request, response) => {
  if (serveDemoSession(request, response)) return;
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/fixture/release-translation") {
    releaseTranslation?.();
    response.writeHead(200).end();
    return;
  }
  if (path === "/api/translate") {
    let raw = "";
    for await (const bytes of request) raw += bytes;
    const { texts } = JSON.parse(raw);
    translations.push(texts);
    if (texts.includes("Inspecting the earlier activity."))
      await new Promise((resolve) => (releaseTranslation = resolve));
    response.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        translations: texts.map((text) =>
          text
            .replaceAll("Inspecting the earlier activity.", "核对较早的活动。")
            .replaceAll("Checking the current activity.", "核对当前活动。")
            .replaceAll(" Preserving the collapsed state.", " 保持收起状态。"),
        ),
      }),
    );
    return;
  }
  try {
    let body = await readFile(join(build, path === "/" ? "index.html" : path));
    if (path === "/")
      body = body
        .toString()
        .replace(
          "<head>",
          `<head><script>(${providerFixture.toString()})();(${historyFixture.toString()})();</script>`,
        );
    response
      .writeHead(200, {
        "Content-Type":
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".html": "text/html",
          }[extname(path === "/" ? "index.html" : path)] ||
          "application/octet-stream",
      })
      .end(body);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const browser = await browserDriver();
try {
  const { page, evaluate, waitFor, click } = browser;
  const emit = (method, params) =>
    evaluate(
      `providerSocket.emit(${JSON.stringify(method)},${JSON.stringify({ threadId: "provider-demo", turnId: "live-turn", ...params })})`,
    );
  const item = (entry) => emit("item/completed", { item: entry });
  const detached = () =>
    evaluate(
      "[...document.querySelectorAll('.assistant-message')].filter(e=>!e.closest('.process-group')).map(e=>e.textContent.trim())",
    );
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.navigate", {
    url: `http://127.0.0.1:${server.address().port}`,
  });
  await waitFor("document.querySelector('.ProseMirror')");
  await waitFor("document.body.innerText.includes('上一轮最终回答。')");
  await emit("turn/started", {
    turn: {
      id: "live-turn",
      status: "inProgress",
      startedAt: Date.now() / 1000,
    },
  });
  const user = {
    id: "live-user",
    type: "userMessage",
    content: [{ type: "text", text: "检查实现，并连续运行工具。" }],
  };
  const first = {
    id: "first-thought",
    type: "reasoning",
    summary: [],
    content: ["Inspecting the earlier activity."],
  };
  const progress = {
    id: "live-progress",
    type: "agentMessage",
    phase: null,
    text: "架构检查通过。继续核对实现。",
  };
  await item(user);
  await item(first);
  await waitFor("document.querySelector('.reasoning-text')");
  await waitFor("document.querySelector('[aria-label=\"正在翻译思考过程\"]')");
  for (let attempt = 0; attempt < 100 && !releaseTranslation; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(typeof releaseTranslation, "function", "首段翻译请求已发出");
  await item(progress);
  await waitFor(
    "document.body.innerText.includes('架构检查通过。继续核对实现。')",
  );
  if (before) {
    assert(
      (await detached()).includes(progress.text),
      "复现中途回复被当成最终回答",
    );
    assert(
      await evaluate(
        "!!document.querySelector('.process-preview .reasoning-text')",
      ),
      "复现较早思考仍在预览中",
    );
    await evaluate("fetch('/fixture/release-translation')");
    await waitFor(
      "document.querySelector('.reasoning-text')?.textContent.includes('核对较早的活动。')",
    );
    await browser.screenshot(join(output, "translated-progress.png"));
    await writeFile(
      join(output, "result.json"),
      JSON.stringify(
        { status: "reproduced", detached: await detached(), build },
        null,
        2,
      ),
    );
    console.log("PASS 精准复现旧活动译文与脱离过程的中途回复同时展开");
  } else {
    assert.deepEqual(await detached(), ["上一轮最终回答。"]);
    assert.equal(
      await evaluate(
        "document.querySelectorAll('.process-preview .reasoning-text').length",
      ),
      0,
    );
    await evaluate("fetch('/fixture/release-translation')");
    await evaluate("new Promise(resolve=>setTimeout(resolve,150))");
    assert.equal(
      await evaluate("document.querySelectorAll('.reasoning-text').length"),
      0,
      "迟到译文保持旧活动收纳",
    );
    await browser.screenshot(join(output, "translated-progress.png"));
    const tool = {
      id: "live-tool",
      type: "commandExecution",
      command: "npm run check",
      status: "completed",
      aggregatedOutput: "检查通过",
      exitCode: 0,
    };
    await item(tool);
    await waitFor(
      "document.querySelector('.process-preview')?.textContent.includes('运行项目检查')",
    );
    assert.equal(
      await evaluate(
        "document.body.innerText.includes('架构检查通过。继续核对实现。')",
      ),
      false,
    );
    const current = {
      id: "current-thought",
      type: "reasoning",
      content: ["Checking the current activity."],
    };
    await item(current);
    await waitFor(
      "document.querySelector('.reasoning-text')?.textContent.includes('核对当前活动。')",
    );
    await click(".reasoning-text > summary");
    await waitFor("!document.querySelector('.reasoning-text').open");
    current.content[0] += " Preserving the collapsed state.";
    await item(current);
    await waitFor(
      "document.querySelector('.reasoning-text')?.textContent.includes('保持收起状态。')",
    );
    assert.equal(
      await evaluate("document.querySelector('.reasoning-text').open"),
      false,
      "译文更新保留手动收起",
    );
    await click(
      ".process-group:has(.process-preview) .process-history > summary",
    );
    await waitFor("document.querySelectorAll('.process-preview').length===0");
    await browser.screenshot(join(output, "expanded.png"));
    await click(".process-history[open] > summary");
    await waitFor("document.querySelectorAll('.process-preview').length===1");
    await browser.screenshot(join(output, "current-activity.png"));
    for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
      await evaluate(`document.documentElement.style.zoom=${zoom}`);
      assert.equal(
        await evaluate("document.documentElement.scrollWidth>innerWidth"),
        false,
        `缩放 ${zoom}`,
      );
    }
    await evaluate("document.documentElement.style.zoom=1");
    const answer = {
      id: "live-answer",
      type: "agentMessage",
      text: "本轮最终回答。",
    };
    await item(answer);
    assert.deepEqual(
      await detached(),
      ["上一轮最终回答。"],
      "无阶段末尾回复等待轮次结束",
    );
    await emit("turn/completed", {
      turn: {
        id: "live-turn",
        status: "completed",
        completedAt: Date.now() / 1000,
      },
    });
    await waitFor("document.querySelectorAll('.process-preview').length===0");
    assert.deepEqual(await detached(), ["上一轮最终回答。", "本轮最终回答。"]);
    await browser.screenshot(join(output, "completed.png"));
    const records = [user, first, progress, tool, current, answer].map(
      (entry) => ({ item: entry, turnId: "live-turn" }),
    );
    await evaluate(
      `localStorage.setItem('fold-records',JSON.stringify([...JSON.parse(localStorage.getItem('fold-records')),...${JSON.stringify(records)}]));localStorage.setItem('fold-turns',${JSON.stringify(
        JSON.stringify([
          { id: "old-turn", status: "completed" },
          { id: "live-turn", status: "completed" },
        ]),
      )})`,
    );
    await page("Page.reload");
    await waitFor("document.body.innerText.includes('本轮最终回答。')");
    assert.deepEqual(await detached(), ["上一轮最终回答。", "本轮最终回答。"]);
    assert.equal(
      await evaluate(
        "document.querySelectorAll('.reasoning-text,.process-preview,.process-history[open]').length",
      ),
      0,
      "刷新后各轮过程默认收起",
    );
    await emit("turn/started", {
      turn: { id: "next-turn", status: "inProgress" },
    });
    await emit("item/completed", {
      turnId: "next-turn",
      item: {
        id: "next-progress",
        type: "agentMessage",
        text: "下一轮当前进度。",
      },
    });
    await waitFor(
      "document.querySelector('.process-preview')?.textContent.includes('下一轮当前进度。')",
    );
    assert.equal(
      await evaluate("document.querySelectorAll('.process-preview').length"),
      1,
    );
    assert.deepEqual(await detached(), ["上一轮最终回答。", "本轮最终回答。"]);
    await click('[title="设置"]');
    await click(".theme-options button:nth-child(2)");
    await click('[title="关闭窗口"]');
    await browser.screenshot(join(output, "dark-next-turn.png"));
    await click('[title="收起侧栏"]');
    await page("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await page("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await evaluate("window.scrollTo(0,0)");
    assert.equal(
      await evaluate("document.documentElement.scrollWidth>innerWidth"),
      false,
    );
    await browser.screenshot(join(output, "dark-mobile.png"));
    const report = {
      status: "passed",
      build,
      missingPhase: true,
      latestOnly: true,
      lateTranslation: true,
      manualCollapse: true,
      toolContinuation: true,
      historyRestored: true,
      nextTurn: true,
      zoom: [80, 100, 125, 150, 200],
      darkMobile: true,
    };
    await writeFile(
      join(output, "result.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report));
  }
  await writeFile(
    join(output, "build-info.json"),
    await readFile(
      join(
        root,
        before
          ? ".cache/process-folding-before/build-info.json"
          : "build-info.json",
      ),
    ),
  );
} finally {
  releaseTranslation?.();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
