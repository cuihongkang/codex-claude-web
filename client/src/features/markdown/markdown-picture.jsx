import React, { useEffect, useState } from "react";
import parseSrcset from "parse-srcset";
import { MessageImage } from "./message-image.jsx";
import { rpc, useStore } from "../../store.js";
import {
  imageDataUrl,
  localImagePath,
  messageUrlTransform,
} from "../../domain/image-source.js";

export function MarkdownPicture({ node, cwd: baseDirectory }) {
  const { connected, current, cwd, defaultCwd, theme } = useStore();
  const directory = baseDirectory ?? (current?.cwd || cwd || defaultCwd);
  const image = node.children.find((child) => child.tagName === "img");
  const sourceText = JSON.stringify(
    node.children
      .filter((child) => child.tagName === "source")
      .map(({ properties }) => properties),
  );
  const key = JSON.stringify([sourceText, directory]);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function resolveSources() {
      const sources = await Promise.all(
        JSON.parse(sourceText).map(async ({ srcSet, media, type, sizes }) => {
          const candidates = await Promise.all(
            parseSrcset(srcSet || "").map(async (candidate) => {
              const url = messageUrlTransform(candidate.url, "src", {
                tagName: "img",
              });
              if (!url) return null;
              const path = localImagePath(url, directory);
              let source = url;
              if (path) {
                if (!connected) return null;
                try {
                  const { dataBase64 } = await rpc("fs/readFile", { path });
                  source = imageDataUrl(path, dataBase64);
                } catch {
                  return null;
                }
              }
              const descriptor = candidate.w
                ? `${candidate.w}w`
                : candidate.d
                  ? `${candidate.d}x`
                  : "";
              return `${source}${descriptor ? " " + descriptor : ""}`;
            }),
          );
          return {
            srcSet: candidates.filter(Boolean).join(", "),
            media,
            type,
            sizes,
          };
        }),
      );
      if (!cancelled) setResult({ key, sources });
    }
    resolveSources();
    return () => {
      cancelled = true;
    };
  }, [sourceText, directory, connected, key]);

  if (!image) return null;
  const sources = result?.key === key ? result.sources : [];
  return (
    <MessageImage
      {...image.properties}
      src={messageUrlTransform(image.properties.src || "", "src", image)}
      cwd={directory}
      sources={sources.map((source) => ({
        ...source,
        // 显式主题优先于系统偏好，其他媒体条件由浏览器原生处理。
        media:
          theme !== "system" &&
          /^\(prefers-color-scheme: (dark|light)\)$/.test(source.media || "")
            ? source.media.includes(theme)
              ? "all"
              : "not all"
            : source.media,
      }))}
    />
  );
}
