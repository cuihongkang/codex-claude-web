import { useEffect, useRef, useState } from "react";
import {
  createSummaryTranslator,
  needsTranslation,
  translateSummaries,
} from "../../infrastructure/summary-translator.js";

try {
  localStorage.removeItem("cx-summary-zh-v1");
} catch {
  // 浏览器禁用本地存储时，继续初始化翻译。
}

let translationStorage;
try {
  translationStorage = sessionStorage;
} catch {
  // 浏览器禁用会话存储时，译文保留在当前页面内存中。
}
const translator = createSummaryTranslator(
  translateSummaries,
  translationStorage,
);

export function useSummaryTranslation(text, priority = "body") {
  const [result, setResult] = useState({});
  const mounted = useRef(false),
    inFlight = useRef(false),
    lastStarted = useRef(0);
  const required = needsTranslation(text);
  const cached = translator.getCached(text);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (
      !required ||
      inFlight.current ||
      result.source === text ||
      cached !== undefined
    )
      return;
    // 标题立即入队；正文按固定间隔取最新文本，持续流式更新也会推进翻译。
    const timer = setTimeout(
      () => {
        inFlight.current = true;
        lastStarted.current = Date.now();
        translator.translate(text, priority).then(
          (value) => {
            inFlight.current = false;
            if (mounted.current) setResult({ source: text, value });
          },
          (error) => {
            inFlight.current = false;
            if (mounted.current)
              setResult({ source: text, error: error.message });
          },
        );
      },
      priority === "title"
        ? 0
        : Math.max(0, lastStarted.current + 300 - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [text, priority, required, result, cached]);
  // 追加中的摘要继续展示已译前缀，新的译文返回后替换，避免反复闪回等待提示。
  const current =
    cached !== undefined
      ? { value: cached }
      : result.source === text ||
          (result.value && text.startsWith(result.source))
        ? result
        : {};
  return {
    text: required ? (current.value ?? text) : text,
    pending: required && !current.value && !current.error,
    error: required ? current.error : undefined,
    retry: () => setResult({}),
  };
}
