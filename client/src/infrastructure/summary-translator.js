const batchLengthLimit = 3000;
const segmentLengthLimit = 1000;
const cacheKey = "cx-summary-zh-session-v1";

export function needsTranslation(text) {
  const prose = text.replace(/```[\s\S]*?```|`[^`]*`/g, "");
  const chinese = prose.match(/[\u3400-\u9fff]/g)?.length || 0;
  const english = prose.match(/[a-zA-Z]/g)?.length || 0;
  return english > 2 && english > chinese * 3;
}

// 标题优先发送；正文合并短时更新，并最多占用一个请求，给后续标题保留容量。
export function createSummaryTranslator(requestBatch, storage) {
  const cache = new Map();
  try {
    const entries = JSON.parse(storage?.getItem(cacheKey) || "[]");
    if (Array.isArray(entries))
      for (const entry of entries)
        if (
          Array.isArray(entry) &&
          entry.length === 2 &&
          entry.every((text) => typeof text === "string" && text.trim())
        )
          cache.set(...entry);
  } catch {
    // 会话存储不可读时，继续使用当前页面的内存缓存。
  }
  const pending = new Map();
  const queue = { title: new Set(), body: new Set() };
  let timer, timerPriority;
  let running = 0,
    bodyRunning = false;
  function schedule() {
    if (running >= 2 || (!queue.title.size && !queue.body.size)) return;
    const priority = queue.title.size ? "title" : "body";
    if (priority === "body" && bodyRunning) return;
    if (timer) {
      if (timerPriority === "title" || priority === "body") return;
      clearTimeout(timer);
    }
    timerPriority = priority;
    timer = setTimeout(flush, priority === "title" ? 0 : 100);
  }
  async function flush() {
    timer = null;
    const priority = queue.title.size ? "title" : "body";
    const batch = [];
    let length = 0;
    for (const text of queue[priority]) {
      if (
        batch.length &&
        (pending.get(text).single || length + text.length > batchLengthLimit)
      )
        break;
      batch.push(text);
      length += text.length;
      if (pending.get(text).single || batch.length === 24) break;
    }
    batch.forEach((text) => queue[priority].delete(text));
    running++;
    if (priority === "body") bodyRunning = true;
    schedule();
    let retryAsSingles = false;
    try {
      const translations = await requestBatch(batch);
      if (
        !Array.isArray(translations) ||
        translations.length !== batch.length ||
        translations.some((text) => typeof text !== "string" || !text.trim())
      )
        throw new Error("翻译结果不完整");
      batch.forEach((text, index) =>
        cache.set(text, translations[index].trim()),
      );
      try {
        storage?.setItem(cacheKey, JSON.stringify([...cache]));
      } catch {
        // 存储被禁用或已满时，已完成译文仍可在当前页面复用。
      }
      batch.forEach((text) => pending.get(text).resolve(cache.get(text)));
    } catch (error) {
      retryAsSingles = batch.length > 1;
      batch.forEach((text) => {
        if (retryAsSingles) {
          pending.get(text).single = true;
          queue[priority].add(text);
        } else pending.get(text).reject(error);
      });
    } finally {
      if (!retryAsSingles) batch.forEach((text) => pending.delete(text));
      running--;
      if (priority === "body") bodyRunning = false;
      schedule();
    }
  }
  return {
    getCached(text) {
      return cache.get(text);
    },
    translate(text, priority = "body") {
      if (!needsTranslation(text)) return Promise.resolve(text);
      if (cache.has(text)) return Promise.resolve(cache.get(text));
      if (pending.has(text)) {
        if (priority === "title" && queue.body.delete(text)) {
          queue.title.add(text);
          schedule();
        }
        return pending.get(text).promise;
      }
      let resolve, reject;
      const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      pending.set(text, { promise, resolve, reject });
      queue[priority].add(text);
      schedule();
      return promise;
    },
  };
}

export async function translateSummaries(texts) {
  // 机器翻译只处理正文，代码、路径和 Markdown 强调标记在返回后原样恢复。
  const protectedParts = texts.map(() => []);
  const source = texts.map((text, index) =>
    text.replace(
      /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|<[^>\n]+>|https?:\/\/[^\s)]+|(?:[A-Za-z]:[\\/]|~?\/|\.{1,2}\/)[^\s`*()[\]<>]+|\b[\w.@-]+(?:\/[\w.@+-]+)+|\*\*|__/g,
      (part) => `<x${protectedParts[index].push(part) - 1}>`,
    ),
  );
  const segments = source.map(splitTranslationText);
  const queued = segments
    .flat()
    .filter((segment) =>
      needsTranslation(segment.source.replace(/<x\d+>/g, "")),
    );
  let offset = 0;
  while (offset < queued.length) {
    const batch = [];
    let length = 0;
    while (
      offset < queued.length &&
      batch.length < 24 &&
      length + queued[offset].source.length <= batchLengthLimit
    ) {
      const segment = queued[offset++];
      batch.push(segment);
      length += segment.source.length;
    }
    const translations = await requestTranslations(
      batch.map((segment) => segment.source),
    );
    batch.forEach((segment, index) => (segment.value = translations[index]));
  }
  return segments.map((chunks, index) => {
    const text = chunks
      .map((chunk) => chunk.before + chunk.value + chunk.after)
      .join("");
    const parts = protectedParts[index];
    const restored = new Set();
    const result = text.replace(/<\s*x\s*(\d+)\s*>/gi, (match, id) => {
      if (parts[id] === undefined || restored.has(id))
        throw new Error("翻译格式异常，请重试");
      restored.add(id);
      return parts[id];
    });
    if (restored.size !== parts.length) throw new Error("翻译格式异常，请重试");
    return result;
  });
}

function splitTranslationText(text) {
  const chunks = [];
  while (text.length) {
    let end = Math.min(text.length, segmentLengthLimit);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end);
      const space = text.lastIndexOf(" ", end);
      if (newline >= end / 2) end = newline;
      else if (space >= end / 2) end = space;
      const tag = text.lastIndexOf("<x", end - 1);
      if (tag >= 0 && text.indexOf(">", tag) >= end) end = tag;
      const last = text.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
    }
    const [, before, source, after] = text
      .slice(0, end)
      .match(/^(\s*)([\s\S]*?)(\s*)$/);
    chunks.push({ before, source, after, value: source });
    text = text.slice(end);
  }
  return chunks;
}

async function requestTranslations(texts) {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 404) throw new Error("翻译暂不可用，请稍后重试");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "翻译服务请求失败，请重试");
  if (
    !Array.isArray(data.translations) ||
    data.translations.length !== texts.length ||
    data.translations.some((text) => typeof text !== "string" || !text.trim())
  )
    throw new Error("翻译结果不完整");
  return data.translations;
}
