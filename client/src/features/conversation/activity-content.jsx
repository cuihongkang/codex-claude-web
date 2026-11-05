import React from "react";
import { defaultUrlTransform } from "react-markdown";
import { RichText } from "../markdown/rich-text.jsx";
import { labels, queries, activityLabel } from "../../domain/activity.js";

import {
  statuses,
  Image,
  ResourceLink,
  ToolValue,
  Section,
} from "./tool-value.jsx";

export function searchResultLinks(value) {
  if (typeof value === "string") {
    try {
      return searchResultLinks(JSON.parse(value));
    } catch {
      return /^https?:\/\/\S+$/.test(value) ? [{ url: value }] : [];
    }
  }
  if (Array.isArray(value)) return value.flatMap(searchResultLinks);
  if (!value || typeof value !== "object") return [];
  const url = value.url || value.uri;
  if (typeof url === "string" && defaultUrlTransform(url))
    return [{ url, title: value.title || value.name }];
  return [
    "results",
    "result",
    "output",
    "content",
    "structuredContent",
    "text",
  ].flatMap((key) => searchResultLinks(value[key]));
}
export function ActivityContent({ item, cwd }) {
  if (item.type === "imageView")
    return (
      <Image
        src={item.path}
        alt={item.path?.split("/").at(-1) || "查看图片"}
        cwd={cwd}
      />
    );
  if (item.type === "imageGeneration")
    return (
      <>
        {item.failure ? (
          <ToolValue value={item.failure} cwd={cwd} />
        ) : item.savedPath || item.result ? (
          <Image
            src={
              item.savedPath ||
              (/^(data:|https?:|\/)/.test(item.result)
                ? item.result
                : `data:image/png;base64,${item.result}`)
            }
            alt="生成的图片"
            cwd={cwd}
          />
        ) : (
          <p>正在生成图片…</p>
        )}
      </>
    );
  if (item.type === "webSearch") {
    const action = item.action || {};
    const results = searchResultLinks(
      item.results || item.result || item.output,
    );
    return (
      <div className="tool-web-details">
        {["openPage", "open_page"].includes(action.type) ? (
          <ResourceLink href={action.url || item.query} cwd={cwd} />
        ) : ["findInPage", "find_in_page"].includes(action.type) ? (
          <>
            <p>
              查找文字：<mark>{action.pattern || item.query}</mark>
            </p>
            {action.url && <ResourceLink href={action.url} cwd={cwd} />}
          </>
        ) : queries(item).length ? (
          <ul className="tool-values">
            {queries(item).map((query) => (
              <li key={query}>{query}</li>
            ))}
          </ul>
        ) : (
          <p>搜索网页</p>
        )}
        {results.length > 0 && (
          <section className="tool-section">
            <small>搜索结果</small>
            <ul className="tool-values">
              {results.map((result, index) => (
                <li key={index}>
                  <ResourceLink href={result.url} cwd={cwd}>
                    {result.title || result.url}
                  </ResourceLink>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Section title="错误" value={item.error} cwd={cwd} />
      </div>
    );
  }
  if (
    ["mcpToolCall", "dynamicToolCall", "functionCallOutput"].includes(item.type)
  ) {
    const result = item.result;
    const output =
      item.contentItems ??
      (result && typeof result === "object" && "content" in result
        ? result.content?.length
          ? result.content
          : result.structuredContent
        : result) ??
      item.output;
    const hasOutput =
      output !== null &&
      output !== undefined &&
      (!Array.isArray(output) || output.length > 0);
    return (
      <>
        <Section title="参数" value={item.arguments} cwd={cwd} />
        {hasOutput ? (
          <Section title="结果" value={output} cwd={cwd} />
        ) : (
          !item.error && (
            <p>
              {["inProgress", "running"].includes(item.status)
                ? "正在执行…"
                : item.success === false ||
                    ["failed", "declined"].includes(item.status)
                  ? "工具执行失败"
                  : "暂无返回内容"}
            </p>
          )
        )}
        <Section title="错误" value={item.error} cwd={cwd} />
      </>
    );
  }
  if (["enteredReviewMode", "exitedReviewMode"].includes(item.type))
    return <RichText text={item.review || labels[item.type]} cwd={cwd} />;
  if (item.type === "contextCompaction")
    return (
      <p>
        {["inProgress", "running"].includes(item.status)
          ? "正在整理上下文…"
          : item.status === "failed"
            ? "上下文整理失败"
            : "上下文整理已完成"}
      </p>
    );
  if (item.type === "sleep") return <p>{activityLabel(item)}</p>;
  if (item.type === "hookPrompt")
    return (
      <ToolValue
        value={item.fragments?.map((fragment) => fragment.text)}
        cwd={cwd}
      />
    );
  const value =
    item.result ??
    item.output ??
    item.action ??
    Object.fromEntries(
      Object.entries(item).filter(
        ([key]) => !["id", "type", "turnId", "status"].includes(key),
      ),
    );
  return value !== null &&
    value !== undefined &&
    (typeof value !== "object" || Object.keys(value).length > 0) ? (
    <ToolValue value={value} cwd={cwd} />
  ) : (
    <p>{statuses[item.status] || "暂无详细内容"}</p>
  );
}
