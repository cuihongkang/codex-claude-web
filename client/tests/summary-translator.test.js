import test from "node:test";
import assert from "node:assert/strict";
import {
  createSummaryTranslator,
  needsTranslation,
  translateSummaries,
} from "../src/summary-translator.js";

test("中文摘要与纯代码直接显示，英文摘要请求翻译", () => {
  assert.equal(needsTranslation("检查当前 Git 分支"), false);
  assert.equal(needsTranslation("`git status`"), false);
  assert.equal(needsTranslation("Identifying Git Branches"), true);
});
test("相同摘要合并进行中请求，完成后复用译文，新增原文独立翻译", async () => {
  const batches = [];
  const translator = createSummaryTranslator(async (texts) => {
    batches.push(texts);
    return texts.map((text) => "译文：" + text);
  });
  const first = translator.translate("Checking files");
  assert.equal(translator.translate("Checking files"), first);
  const second = translator.translate("Reviewing changes");
  await Promise.all([first, second]);
  assert.deepEqual(batches, [["Checking files", "Reviewing changes"]]);
  assert.equal(
    await translator.translate("Checking files"),
    "译文：Checking files",
  );
  assert.equal(
    await translator.translate("Checking files", "title"),
    "译文：Checking files",
  );
  assert.equal(translator.getCached("Checking files"), "译文：Checking files");
  assert.deepEqual(batches, [["Checking files", "Reviewing changes"]]);
  assert.equal(translator.getCached("Checking files again"), undefined);
  await translator.translate("Checking files again");
  assert.deepEqual(batches.at(-1), ["Checking files again"]);
  assert.equal(await translator.translate("已经是中文"), "已经是中文");
});

test("同一标签页会话恢复成功译文，新会话重新翻译，失败保留重试", async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const batches = [];
  let failing = true;
  const request = async (texts) => {
    batches.push(texts);
    if (failing && texts.includes("Retry this summary"))
      throw new Error("模拟翻译失败");
    return texts.map((text) => "译文：" + text);
  };
  const first = createSummaryTranslator(request, storage);
  await first.translate("Stored summary");
  await assert.rejects(first.translate("Retry this summary"), /模拟翻译失败/);
  const reloaded = createSummaryTranslator(request, storage);
  assert.equal(reloaded.getCached("Stored summary"), "译文：Stored summary");
  assert.equal(reloaded.getCached("Retry this summary"), undefined);
  assert.equal(
    await reloaded.translate("Stored summary"),
    "译文：Stored summary",
  );
  assert.equal(batches.length, 2, "刷新后的成功译文直接读取会话缓存");
  failing = false;
  await reloaded.translate("Retry this summary");
  assert.equal(batches.length, 3, "失败原文重新请求");
  values.clear();
  const reopened = createSummaryTranslator(request, storage);
  assert.equal(reopened.getCached("Stored summary"), undefined);
  await reopened.translate("Stored summary");
  assert.equal(batches.length, 4, "新会话重新取得译文");
});

test("会话缓存损坏、存储不可读或写满时继续翻译并保留页面内缓存", async () => {
  for (const saved of ["{", "null", "{}", '[null,["Stored summary",123]]']) {
    let requests = 0;
    const translator = createSummaryTranslator(
      async () => {
        requests++;
        return ["检查摘要"];
      },
      { getItem: () => saved, setItem() {} },
    );
    assert.equal(await translator.translate("Stored summary"), "检查摘要");
    assert.equal(await translator.translate("Stored summary"), "检查摘要");
    assert.equal(requests, 1);
  }
  let requests = 0;
  const translator = createSummaryTranslator(
    async () => {
      requests++;
      return ["检查摘要"];
    },
    {
      getItem() {
        throw new Error("存储不可读");
      },
      setItem() {
        throw new Error("存储已满");
      },
    },
  );
  assert.equal(await translator.translate("Stored summary"), "检查摘要");
  assert.equal(await translator.translate("Stored summary"), "检查摘要");
  assert.equal(requests, 1);
});
test("翻译失败保留重试能力，缺失条目不会错配到其他摘要", async () => {
  let attempts = 0;
  const translator = createSummaryTranslator(async () =>
    ++attempts === 1 ? [] : ["检查文件"],
  );
  await assert.rejects(translator.translate("Checking files"), /不完整/);
  assert.equal(await translator.translate("Checking files"), "检查文件");
});

test("标题立即发送并越过正文队列，慢正文仍为后续标题保留容量", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const batches = [];
  let finishBody;
  const translator = createSummaryTranslator(async (texts) => {
    batches.push(texts);
    if (texts.includes("Slow background paragraph"))
      await new Promise((resolve) => (finishBody = resolve));
    return texts.map((text) => "译文：" + text);
  });
  const body = translator.translate("Slow background paragraph");
  const firstTitle = translator.translate("First heading", "title");
  t.mock.timers.tick(0);
  await firstTitle;
  assert.deepEqual(batches, [["First heading"]]);
  t.mock.timers.tick(100);
  assert.deepEqual(batches[1], ["Slow background paragraph"]);

  const nextBody = translator.translate("Next background paragraph");
  const nextTitle = translator.translate("Next heading", "title");
  t.mock.timers.tick(0);
  await nextTitle;
  assert.deepEqual(batches[2], ["Next heading"]);
  t.mock.timers.tick(1000);
  assert.equal(batches.length, 3);

  finishBody();
  await body;
  t.mock.timers.tick(100);
  await nextBody;
  assert.deepEqual(batches[3], ["Next background paragraph"]);
});

test("同一原文从正文提升为标题时立即发送并复用请求", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const batches = [];
  const translator = createSummaryTranslator(async (texts) => {
    batches.push(texts);
    return texts.map(() => "共享译文");
  });
  const body = translator.translate("Shared translation text");
  const title = translator.translate("Shared translation text", "title");
  assert.equal(title, body);
  t.mock.timers.tick(0);
  assert.equal(await title, "共享译文");
  assert.deepEqual(batches, [["Shared translation text"]]);
});

test("长历史按正文总量分批，单条失败后隔离重试并保留其他译文", async () => {
  const batches = [];
  const sources = Array.from(
    { length: 12 },
    (_, index) =>
      `Inspect item ${index}. ` + "Review the current settings. ".repeat(30),
  );
  const translator = createSummaryTranslator(async (texts) => {
    batches.push(texts);
    assert(texts.join("").length <= 3000, "历史正文请求限制总长度");
    if (texts.includes(sources[4])) throw new Error("模拟单条正文翻译失败");
    return texts.map((text) => "译文：" + text);
  });
  const results = await Promise.allSettled(
    sources.map((source) => translator.translate(source)),
  );
  for (const [index, result] of results.entries()) {
    assert.equal(result.status, index === 4 ? "rejected" : "fulfilled");
    if (result.status === "fulfilled")
      assert.equal(result.value, "译文：" + sources[index].trim());
  }
  assert(batches.some((batch) => batch.length > 1));
  assert(
    batches.some((batch) => batch.length === 1 && batch[0] === sources[4]),
  );
});

test("长摘要拆段请求并恢复段落、代码、路径和 Unicode，长历史保持原顺序", async (t) => {
  const batches = [];
  const paragraph = "Inspect the selected workspace and preserve its state. ";
  const sources = Array.from(
    { length: 12 },
    (_, index) =>
      `  Inspect item ${index}.\n\n` +
      paragraph.repeat(35) +
      `\n\nInspect \`/fixture/${index}/config.js\` and **keep the existing behavior**.\n  `,
  );
  sources.push(
    "a".repeat(999) + "🚀Inspect `config.model`\n\n" + paragraph.repeat(30),
  );
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/translate");
    const { texts } = JSON.parse(options.body);
    batches.push(texts);
    assert(texts.length <= 24);
    assert(texts.join("").length <= 3000);
    for (const text of texts) {
      assert(text.length <= 1000, "长正文按翻译段落限制长度");
      assert(text.isWellFormed(), "分段保留完整的 Unicode 字符");
      assert(!/<x\d*$/.test(text), "分段保留完整代码占位符");
      assert(!text.includes("/fixture/"));
    }
    return Response.json({
      translations: texts.map((text) =>
        text.replaceAll("Inspect", "检查").trim(),
      ),
    });
  });
  assert.deepEqual(
    await translateSummaries(sources),
    sources.map((source) => source.replaceAll("Inspect", "检查")),
  );
  assert(batches.length > 1);
});

test("通过本站批量请求翻译，恢复代码、路径和 Markdown 标记", async (t) => {
  const source =
    "**Reviewing changes**\nUpdate `config.model` in client/src/store.js and /tmp/config.json.\nSee https://example.com/docs and C:\\project\\file.js.\n<x0>\n```js\nconst ready = true;\n```";
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/translate");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.ok(options.signal instanceof AbortSignal);
    const request = JSON.parse(options.body);
    assert.deepEqual(Object.keys(request), ["texts"]);
    assert.equal(request.texts.length, 2);
    for (const protectedText of [
      "config.model",
      "client/src/store.js",
      "/tmp/config.json",
      "https://example.com/docs",
      "C:\\project\\file.js",
      "const ready = true;",
      "**",
    ])
      assert.ok(!request.texts[1].includes(protectedText));
    return new Response(
      JSON.stringify({
        translations: [
          "检查文件",
          request.texts[1]
            .replace("Reviewing changes", "审查更改")
            .replace(/<x(\d+)>/g, "<x $1>"),
        ],
      }),
    );
  });
  assert.deepEqual(await translateSummaries(["Checking files", source]), [
    "检查文件",
    source.replace("Reviewing changes", "审查更改"),
  ]);
});

test("翻译服务异常或条目缺失时报告失败", async (t) => {
  for (const [data, status, message] of [
    [{}, 404, /翻译暂不可用/],
    [{}, 503, /请求失败/],
    [{ error: "翻译服务暂不可用，请重试" }, 502, /暂不可用/],
    [{ translations: [] }, 200, /不完整/],
    [{ translations: [""] }, 200, /不完整/],
  ]) {
    const mock = t.mock.method(
      globalThis,
      "fetch",
      async () => new Response(JSON.stringify(data), { status }),
    );
    await assert.rejects(translateSummaries(["Checking files"]), message);
    mock.mock.restore();
  }
});

test("翻译不可用时提示用户稍后重试", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("Not found", { status: 404 }),
  );
  await assert.rejects(translateSummaries(["Checking files"]), /翻译暂不可用/);
});

test("代码占位符缺失、重复或未知时拒绝译文，重试可恢复", async (t) => {
  let translation;
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          translations: [translation],
        }),
      ),
  );
  const translator = createSummaryTranslator(translateSummaries);
  const source = "Checking `config.model`";
  for (translation of ["检查配置", "检查<x0><x0>", "检查<x1>"])
    await assert.rejects(translator.translate(source), /格式异常/);
  translation = "检查<x 0>";
  assert.equal(await translator.translate(source), "检查`config.model`");
});
