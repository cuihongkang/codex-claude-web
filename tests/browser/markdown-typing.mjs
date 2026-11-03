import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveDemoSession } from "../helpers/browser-session.mjs";
import { historyPerformanceFixture } from "../fixtures/history-performance.mjs";
const editorAssetTypes = {
  js: "text/javascript",
  css: "text/css",
  png: "image/png",
  ico: "image/x-icon",
};

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const output = join(
  root,
  ".cache/markdown-typing",
  before ? "before" : "after",
);
await mkdir(output, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const server = http.createServer(async (request, response) => {
  if (serveDemoSession(request, response)) return;
  try {
    const path = new URL(request.url, "http://fixture").pathname;
    let body = await readFile(
      join(root, "client/dist", path === "/" ? "index.html" : path),
    );
    if (path === "/")
      body = body
        .toString()
        .replace(
          "<head>",
          `<head><script>(${historyPerformanceFixture.toString()})()</script>`,
        );
    response
      .writeHead(200, {
        "Content-Type":
          path === "/"
            ? "text/html"
            : editorAssetTypes[extname(path).slice(1)] ||
              "application/octet-stream",
      })
      .end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--no-proxy-server"],
});
const results = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1040, height: 780 },
  });
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  const cases = [
    {
      id: "math-code-keys",
      text: "代码 `$$x^2$$`",
      method: "keys",
      selector: "code",
    },
    {
      id: "math-middle",
      prefix: "前文 ",
      text: "$$x^2$$ 后文 $$y^2$$ 结尾",
      method: "insert",
      selector: ".katex",
    },
    {
      id: "math-code",
      text: "代码 `$$x^2$$`",
      method: "paste",
      selector: "code",
    },
    { id: "math-unclosed", text: "$$\nx^2", method: "paste", selector: "p" },
    {
      id: "single-dollar-insert",
      text: "$x^2$",
      method: "insert",
      selector: "p",
    },
    {
      id: "single-dollar-paste",
      text: "$x^2$",
      method: "paste",
      selector: "p",
    },
    { id: "math-ime", text: "$$x^2$$", method: "ime-math", selector: ".katex" },
    {
      id: "user-list-math",
      text: "- $$x_{t+1}=x_{t}+dx$$",
      method: "keys",
      selector: "li .katex",
    },
    {
      id: "user-list-math-insert",
      text: "- $$x_{t+1}=x_{t}+dx$$",
      method: "insert",
      selector: "li .katex",
    },
    {
      id: "user-list-math-paste",
      text: "- $$x_{t+1}=x_{t}+dx$$",
      method: "paste",
      selector: "li .katex",
    },
    { id: "inline-keys", text: "**bold**", method: "keys", selector: "strong" },
    {
      id: "inline-insert",
      text: "**加粗**",
      method: "insert",
      selector: "strong",
    },
    { id: "inline-ime", text: "**加粗**", method: "ime", selector: "strong" },
    { id: "heading-insert", text: "# 标题", method: "insert", selector: "h1" },
    { id: "list-insert", text: "- 列表", method: "insert", selector: "li" },
    {
      id: "code-keys",
      text: "```js\nconst x = 1;\n```",
      method: "keys",
      selector: ".milkdown-code-block",
    },
    {
      id: "task-keys",
      text: "- [ ] 待办",
      method: "keys",
      selector: "input[type=checkbox]",
    },
    {
      id: "quote-keys",
      text: "> 引用",
      method: "keys",
      selector: "blockquote",
    },
    { id: "ordered-keys", text: "1. 条目", method: "keys", selector: "ol li" },
    { id: "strike-keys", text: "~~removed~~", method: "keys", selector: "del" },
    {
      id: "link-keys",
      text: "[link](https://example.com)",
      method: "keys",
      selector: "a",
    },
    {
      id: "math-double-keys",
      text: "$$\nx^2+y^2=1\n$$",
      method: "keys",
      selector: ".document-math-inline .katex",
    },
    {
      id: "math-double-same-line",
      text: "$$x^2+y^2=1$$",
      method: "keys",
      selector: ".document-math-inline .katex",
    },
    {
      id: "math-double-insert",
      text: "$$x^2+y^2=1$$",
      method: "insert",
      selector: ".document-math-inline .katex",
    },
    {
      id: "math-double-paste",
      text: "$$x^2+y^2=1$$",
      method: "paste",
      selector: ".document-math-inline .katex",
    },
    {
      id: "math-insert",
      text: "正文 $$x^2$$ 继续",
      method: "insert",
      selector: ".katex",
    },
    {
      id: "single-dollar-literal",
      text: "$x^2$",
      method: "keys",
      selector: "p",
    },
    {
      id: "table-keys",
      text: "| 名称 | 数值 |\n| --- | --- |\nalpha",
      method: "keys",
      selector: "td",
    },
  ];
  for (const scenario of cases) {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page
      .getByRole("button", { name: /^简短对话/ })
      .click({ timeout: 5000 })
      .catch(async (error) => {
        await page.screenshot({ path: join(output, "failure.png") });
        console.log(await page.locator("body").innerText());
        throw error;
      });
    const field = page.locator(".markdown-composer .ProseMirror");
    await field.waitFor();
    await field.click();
    if (scenario.prefix) await page.keyboard.insertText(scenario.prefix);
    if (scenario.method === "keys") {
      const lines = scenario.text.split("\n");
      for (let index = 0; index < lines.length; index++) {
        if (index) await page.keyboard.press("Enter");
        await page.keyboard.type(lines[index]);
      }
    } else if (scenario.method === "ime-math") {
      const device = await page.context().newCDPSession(page);
      await device.send("Input.imeSetComposition", {
        text: scenario.text,
        selectionStart: scenario.text.length,
        selectionEnd: scenario.text.length,
      });
      await device.send("Input.insertText", { text: scenario.text });
      await device.detach();
    } else if (scenario.method === "ime") {
      await page.keyboard.type("**");
      const device = await page.context().newCDPSession(page);
      await device.send("Input.imeSetComposition", {
        text: "加粗",
        selectionStart: 2,
        selectionEnd: 2,
      });
      await device.send("Input.insertText", { text: "加粗" });
      await page.keyboard.type("**");
      await device.detach();
    } else if (scenario.method === "paste") {
      await field.evaluate((element, text) => {
        const transfer = new DataTransfer();
        transfer.setData("text/plain", text);
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          }),
        );
      }, scenario.text);
    } else await page.keyboard.insertText(scenario.text);
    await page.waitForTimeout(350);
    const rendered = await field.locator(scenario.selector).count();
    const draft = await page.evaluate(() =>
      localStorage.getItem("cx-draft-short"),
    );
    if (
      !before &&
      !(await field.locator(scenario.selector).first().isVisible())
    ) {
      await page
        .locator(".composer")
        .screenshot({ path: join(output, "failure.png") });
      await writeFile(join(output, "failure.html"), await field.innerHTML());
      throw new Error(scenario.id + " 排版不可见，草稿：" + draft);
    }
    results.push({
      ...scenario,
      rendered,
      draft,
      html: await field.innerHTML(),
    });
    await page
      .locator(".composer")
      .screenshot({ path: join(output, scenario.id + ".png") });
    if (!before)
      assert(!draft.includes("<br />"), "草稿应保留用户语法并省去编辑占位节点");
    if (scenario.id.startsWith("user-list-math"))
      assert.equal(draft.trim(), scenario.text);
    if (scenario.id.startsWith("single-dollar")) {
      assert.equal(await field.locator(".katex").count(), 0);
      assert.equal(await field.textContent(), "$x^2$");
    }
    if (scenario.id === "math-middle") {
      assert.equal(await field.locator(".katex").count(), 2);
      await page.keyboard.insertText("光标");
      assert((await field.textContent()).endsWith("结尾光标"));
    }
    if (["math-code", "math-code-keys", "math-unclosed"].includes(scenario.id))
      assert.equal(await field.locator(".katex").count(), 0);
    if (scenario.id === "code-keys") assert.equal(draft.trim(), scenario.text);
    if (scenario.id === "table-keys") {
      assert(
        (await field.locator("td").first().textContent()).includes("alpha"),
      );
      assert(
        !(await field.locator("th").allTextContents())
          .join("")
          .includes("alpha"),
      );
    }
    if (!before)
      assert(rendered > 0, `${scenario.id} 直接输入后应自动排版：${draft}`);
  }
  await writeFile(
    join(output, "results.json"),
    JSON.stringify({ before, results, errors }, null, 2),
  );
  if (!before) assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      results.map(({ id, rendered, draft }) => ({ id, rendered, draft })),
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
