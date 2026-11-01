import { serveDemoSession } from "../helpers/browser-session.mjs";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile, mkdir, mkdtemp, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const sourceBuild = join(
  root,
  before ? ".cache/file-preview-before/dist" : "client/dist",
);
const build = await mkdtemp(join(tmpdir(), "codex-web-file-build-"));
await cp(sourceBuild, build, { recursive: true });
const buildInfo = JSON.parse(
  await readFile(
    join(
      root,
      before ? ".cache/file-preview-before/build-info.json" : "build-info.json",
    ),
    "utf8",
  ),
);
const output = join(
  root,
  ".cache/file-preview-browser",
  before ? "before" : "after",
);
await mkdir(output, { recursive: true });
const media = await mkdtemp(join(tmpdir(), "codex-web-video-"));
const videoPath = join(media, "训练录像 #1.MP4");
execFileSync("ffmpeg", [
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=640x360:rate=24",
  "-t",
  "12",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  videoPath,
]);
await writeFile(join(media, "broken.mp4"), "invalid video");
const videoBytes = await readFile(videoPath);
await writeFile(join(media, "second.mp4"), videoBytes);
execFileSync("ffmpeg", [
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=3",
  join(media, "试听.WAV"),
]);
execFileSync("ffmpeg", [
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "color=c=royalblue:s=320x180",
  "-frames:v",
  "1",
  "-threads",
  "1",
  join(media, "picture.BMP"),
]);
const pdfParts = ["%PDF-1.4\n"];
const pdfStream = "BT /F1 24 Tf 50 140 Td (PDF preview fixture) Tj ET\n";
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${Buffer.byteLength(pdfStream)} >>\nstream\n${pdfStream}endstream`,
];
const offsets = [0];
for (const [i, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(pdfParts.join("")));
  pdfParts.push(`${i + 1} 0 obj\n${object}\nendobj\n`);
}
const xref = Buffer.byteLength(pdfParts.join(""));
pdfParts.push(
  `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
);
await writeFile(join(media, "说明.pdf"), pdfParts.join(""));
await writeFile(
  join(media, "archive.zip"),
  Buffer.from("UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==", "base64"),
);
await writeFile(
  join(media, "table.xlsx"),
  Buffer.from("UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==", "base64"),
);
await writeFile(
  join(media, "opaque.data"),
  Buffer.from([255, 254, 1, 2, 3, 4]),
);
await writeFile(join(media, "settings.json"), '{"preview":true}');
await writeFile(
  join(media, "page.html"),
  "<script>window.fileScriptRan=true</script>",
);
const fixtureFiles = {};
for (const name of [
  "训练录像 #1.MP4",
  "second.mp4",
  "试听.WAV",
  "picture.BMP",
  "说明.pdf",
  "archive.zip",
  "table.xlsx",
  "opaque.data",
  "settings.json",
  "page.html",
])
  fixtureFiles[name] = (await readFile(join(media, name))).toString("base64");
const serveFile = before
  ? null
  : (await import("../../server/src/file-content.mjs")).serveFile;

function fixture(directory, files) {
  localStorage.clear();
  const thread = {
    id: "video-fixture",
    name: "文件打开验证",
    cwd: directory,
    createdAt: 1,
    completedAt: 2,
  };
  const items = [
    {
      id: "user",
      type: "userMessage",
      content: [{ type: "text", text: "查看两段 12 秒训练录像。" }],
    },
    {
      id: "answer",
      type: "agentMessage",
      phase: "final_answer",
      text: [
        "可直接对照这两段 **12 秒首回合片段**：",
        "",
        `- [成功爬升录像](<${directory}/训练录像%20%231.MP4>)`,
        "- [持续卡住录像](./second.mp4)",
        "- [损坏录像](./broken.mp4)",
        "- [缺失录像](./missing.mp4)",
        "- [音频试听](./试听.WAV)",
        "- [PDF 文档](./说明.pdf)",
        "- [BMP 图片](./picture.BMP)",
        "- [压缩包](./archive.zip)",
        "- [电子表格](./table.xlsx)",
        "- [未知二进制](./opaque.data)",
        "- [文本配置](./settings.json)",
        "- [HTML 源码](./page.html)",
        "",
        "训练仍在运行，检查结束时已到 **249 轮**。",
      ].join("\n"),
    },
  ];
  localStorage.setItem("cx-current", thread.id);
  localStorage.setItem("cx-theme", JSON.stringify("light"));
  window.videoFixture = { requests: [] };
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      setTimeout(
        () =>
          this.onmessage({
            data: JSON.stringify({
              method: "lan/state",
              params: {
                ready: true,
                defaultCwd: directory,
                activeTurns: {},
                questions: [],
              },
            }),
          }),
        0,
      );
    }
    send(raw) {
      const m = JSON.parse(raw);
      window.videoFixture.requests.push(m);
      let result = {};
      if (m.method === "thread/list")
        result = { data: [thread], nextCursor: null };
      if (["thread/read", "thread/resume"].includes(m.method))
        result = { thread, cwd: directory };
      if (m.method === "thread/turns/list")
        result = {
          data: [{ id: "turn", status: "completed" }],
          nextCursor: null,
        };
      if (m.method === "thread/items/list")
        result = {
          data: [...items].reverse().map((item) => ({ turnId: "turn", item })),
          nextCursor: null,
        };
      if (["model/list", "skills/list"].includes(m.method))
        result = { data: [] };
      if (m.method === "config/read") result = { config: {} };
      if (m.method === "lan/projectless/read") result = { directories: {} };
      if (m.method === "fs/readDirectory")
        result = {
          entries: [{ fileName: "训练录像 #1.MP4", isDirectory: false }],
        };
      if (m.method === "fs/readFile")
        result = {
          dataBase64:
            files[m.params.path.slice(directory.length + 1)] ||
            files["训练录像 #1.MP4"],
        };
      setTimeout(
        () => this.onmessage({ data: JSON.stringify({ id: m.id, result }) }),
        0,
      );
    }
  };
}

const mediaRequests = [];
const server = http.createServer(async (req, res) => {
  if (serveDemoSession(req, res)) return;
  const url = new URL(req.url, "http://fixture");
  if (["/api/files", "/api/media"].includes(url.pathname)) {
    mediaRequests.push({
      path: url.searchParams.get("path"),
      range: req.headers.range,
    });
    await serveFile(req, res);
    return;
  }
  try {
    let content = await readFile(
      join(build, url.pathname === "/" ? "index.html" : url.pathname),
    );
    if (url.pathname === "/")
      content = content
        .toString()
        .replace(
          "<head>",
          `<head><script>(${fixture.toString()})(${JSON.stringify(media)},${JSON.stringify(fixtureFiles)})</script>`,
        );
    res
      .writeHead(200, {
        "Content-Type":
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".html": "text/html; charset=utf-8",
          }[extname(url.pathname)] || "text/html; charset=utf-8",
      })
      .end(content);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const profile = await mkdtemp(join(tmpdir(), "codex-web-video-browser-"));
assert(process.env.CHROME_PATH, "通过 CHROME_PATH 指定 Chromium 可执行文件");
const child = spawn(
  process.env.CHROME_PATH,
  [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--no-proxy-server",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profile,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(Error("浏览器启动超时")), 10000);
    child.stderr.on("data", (data) => {
      log += data;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(log);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on("error", reject);
  });
  ws = new WebSocket(endpoint);
  await new Promise((resolve) =>
    ws.addEventListener("open", resolve, { once: true }),
  );
  let sequence = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    if (!m.id) return;
    const request = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) request.reject(Error(JSON.stringify(m.error)));
    else request.resolve(m.result);
  });
  const call = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const { targetId } = await call("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await call("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const page = (method, params) => call(method, params, sessionId);
  const evaluate = async (expression) => {
    const result = await page("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression) => {
    for (let i = 0; i < 200; i++) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw Error(
      "等待超时：" +
        expression +
        "\n" +
        (await evaluate("document.body.innerText")),
    );
  };
  const click = async (selector) => {
    const point = await evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    for (const type of ["mousePressed", "mouseReleased"])
      await page("Input.dispatchMouseEvent", {
        type,
        button: "left",
        clickCount: 1,
        ...point,
      });
    await new Promise((resolve) => setTimeout(resolve, 80));
  };
  const screenshot = async (name) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const { data } = await page("Page.captureScreenshot", { format: "png" });
    await writeFile(join(output, name + ".png"), Buffer.from(data, "base64"));
  };
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.navigate", {
    url: `http://127.0.0.1:${server.address().port}`,
  });
  await waitFor("document.querySelector('.message-link')");
  await click(before ? ".message-link[href$='.WAV']" : ".message-link");
  const results = {};
  if (before) {
    await waitFor("document.body.innerText.includes('这是二进制文件')");
    assert.equal(
      await evaluate("document.querySelectorAll('video').length"),
      0,
    );
    await screenshot("desktop-binary-notice");
    await waitFor("!document.body.innerText.includes('这是二进制文件')");
    await click(".message-link[href$='.pdf']");
    await waitFor(
      "document.querySelector('.cm-editor')?.textContent.includes('%PDF-1.4')",
    );
    assert.equal(
      await evaluate(
        "document.querySelectorAll('.file-preview object').length",
      ),
      0,
    );
    await screenshot("pdf-source-before");
  } else {
    await waitFor("document.querySelector('video')?.readyState >= 2");
    results.metadata = await evaluate(
      "(()=>{const v=document.querySelector('video');return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,controls:v.controls}})()",
    );
    assert.equal(results.metadata.duration, 12);
    assert.equal(results.metadata.width, 640);
    await screenshot("desktop-video");
    const bounds = await evaluate(
      "(()=>{const r=document.querySelector('video').getBoundingClientRect();return {x:r.x+30,y:r.bottom-25}})()",
    );
    for (const type of ["mousePressed", "mouseReleased"])
      await page("Input.dispatchMouseEvent", {
        type,
        button: "left",
        clickCount: 1,
        ...bounds,
      });
    await waitFor("document.querySelector('video').currentTime > 0.1");
    await evaluate("document.querySelector('video').pause()");
    await evaluate("document.querySelector('video').currentTime=8");
    await waitFor(
      "document.querySelector('video').currentTime>=8 && !document.querySelector('video').seeking",
    );
    results.seek = await evaluate(
      "document.querySelector('video').currentTime",
    );
    await screenshot("desktop-seek");
    await click(".message-link[href$='second.mp4']");
    await waitFor(
      "document.querySelector('video')?.readyState >= 2 && document.querySelector('video').currentTime===0",
    );
    assert(
      await evaluate(
        "document.querySelector('video').src.includes('second.mp4')",
      ),
    );
    assert(mediaRequests.some((r) => r.range));
    assert.equal(
      await evaluate(
        "window.videoFixture.requests.filter(r=>r.method==='fs/readFile').length",
      ),
      0,
    );
    await click(".file-tab > button:first-child");
    await click(".tree-row");
    await waitFor("document.querySelector('video')?.readyState >= 2");
    const layouts = [];
    for (const theme of ["light", "dark"]) {
      await evaluate(
        `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
      );
      for (const width of [1440, 390]) {
        await page("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: width < 500,
        });
        layouts.push(
          await evaluate(
            "(()=>{const v=document.querySelector('video').getBoundingClientRect();const p=document.querySelector('.file-preview').getBoundingClientRect();return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,contained:v.x>=p.x&&v.right<=p.right&&v.bottom<=p.bottom}})()",
          ),
        );
        await screenshot(`${width}-${theme}`);
      }
    }
    assert(layouts.every((l) => !l.overflow && l.contained));
    results.layouts = layouts;
    await page("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await click(".message-link[href$='broken.mp4']");
    await waitFor("document.body.innerText.includes('视频加载失败')");
    await screenshot("decode-error");
    await click(".file-preview button");
    await waitFor("document.body.innerText.includes('视频加载失败')");
    await click(".message-link[href$='missing.mp4']");
    await waitFor("document.body.innerText.includes('视频加载失败')");
    await writeFile(join(media, "missing.mp4"), videoBytes);
    await click(".file-preview button");
    await waitFor("document.querySelector('video')?.readyState >= 2");
    await screenshot("retry-recovered");
    await evaluate("document.documentElement.dataset.theme='light'");
    await click(".message-link[href$='.WAV']");
    await waitFor("document.querySelector('audio')?.readyState >= 2");
    assert.equal(await evaluate("document.querySelector('audio').duration"), 3);
    const audioPoint = await evaluate(
      "(()=>{const r=document.querySelector('audio').getBoundingClientRect();return {x:r.x+30,y:r.y+r.height/2}})()",
    );
    for (const type of ["mousePressed", "mouseReleased"])
      await page("Input.dispatchMouseEvent", {
        type,
        button: "left",
        clickCount: 1,
        ...audioPoint,
      });
    await waitFor("document.querySelector('audio').currentTime>0.1");
    await screenshot("audio-playback");
    await evaluate(
      "void(window.previousAudio=document.querySelector('audio'))",
    );
    await click(".message-link[href$='.BMP']");
    assert(
      await evaluate(
        "window.previousAudio.paused && !window.previousAudio.getAttribute('src')",
      ),
    );
    await waitFor(
      "document.querySelector('.file-preview img')?.naturalWidth===320",
    );
    await screenshot("image-preview");
    await click(".message-link[href$='.pdf']");
    await waitFor("document.querySelector('.file-preview object')");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await screenshot("pdf-preview");
    const downloads = [];
    const downloadDirectory = join(output, "downloads");
    await mkdir(downloadDirectory, { recursive: true });
    await call("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloadDirectory,
    });
    for (const name of ["archive.zip", "table.xlsx", "opaque.data"]) {
      await click(`.message-link[href$='${name}']`);
      await waitFor("document.querySelector('.file-download')");
      assert.equal(
        await evaluate("document.querySelectorAll('.cm-editor').length"),
        0,
      );
      await click(".file-download");
      for (let i = 0; i < 100; i++) {
        try {
          assert.deepEqual(
            await readFile(join(downloadDirectory, name)),
            Buffer.from(fixtureFiles[name], "base64"),
          );
          break;
        } catch (error) {
          if (i === 99) throw error;
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
      }
      downloads.push(name);
      await screenshot("download-" + name.replaceAll(".", "-"));
    }
    results.downloads = downloads;
    await click(".message-link[href$='settings.json']");
    await waitFor(
      "document.querySelector('.cm-editor')?.textContent.includes('preview')",
    );
    await click(".message-link[href$='page.html']");
    await waitFor(
      "document.querySelector('.cm-editor')?.textContent.includes('fileScriptRan')",
    );
    assert.equal(await evaluate("Boolean(window.fileScriptRan)"), false);
    const previewLayouts = [];
    for (const theme of ["light", "dark"])
      for (const [name, selector] of [
        ["试听.WAV", "audio"],
        ["picture.BMP", "img"],
        ["说明.pdf", "object"],
        ["table.xlsx", ".file-download-info"],
      ]) {
        await evaluate(
          `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
        );
        await page("Emulation.setDeviceMetricsOverride", {
          width: 1440,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await click(`.message-link[href$='${name}']`);
        await waitFor(`document.querySelector('.file-preview ${selector}')`);
        for (const width of [1440, 390]) {
          await page("Emulation.setDeviceMetricsOverride", {
            width,
            height: 900,
            deviceScaleFactor: 1,
            mobile: width < 500,
          });
          await new Promise((resolve) => setTimeout(resolve, 250));
          const layout = await evaluate(
            `(()=>{const v=document.querySelector('.file-preview ${selector}').getBoundingClientRect();const p=document.querySelector('.file-preview').getBoundingClientRect();return {theme:${JSON.stringify(theme)},name:${JSON.stringify(name)},width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,contained:v.x>=p.x&&v.right<=p.right+1&&v.bottom<=p.bottom+1}})()`,
          );
          assert(!layout.overflow && layout.contained, JSON.stringify(layout));
          previewLayouts.push(layout);
          await screenshot(`${selector.replaceAll(".", "")}-${width}-${theme}`);
        }
      }
    results.previewLayouts = previewLayouts;
  }
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        passed: true,
        before,
        buildInfo,
        fixture:
          "临时生成的音视频、PDF、BMP、归档及二进制样本与模拟 WebSocket 历史",
        mediaRequests,
        ...results,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, before, output, ...results }));
} finally {
  ws?.close();
  if (child.exitCode === null && child.signalCode === null) {
    const closed = once(child, "close");
    child.kill();
    await closed;
  }
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50,
  });
  await rm(media, { recursive: true, force: true });
  await rm(build, { recursive: true, force: true });
}
