import React, { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { IconButton } from "../../ui/primitives.jsx";
import { copy, useStore } from "../../store.js";
import { renderMermaid } from "./mermaid-renderer.js";

export function MermaidBlock({ source }) {
  const { theme } = useStore();
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [result, setResult] = useState(null);
  const [showSource, setShowSource] = useState(false);
  const diagramTheme =
    theme === "dark" || (theme === "system" && systemDark) ? "dark" : "default";
  const current =
    result?.source === source && result.theme === diagramTheme ? result : null;

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // 流式代码稳定后再绘制；旧请求完成时只更新其对应的源码和主题。
    const timer = setTimeout(() => {
      renderMermaid(source, diagramTheme).then(
        (svg) => {
          if (!cancelled) setResult({ source, theme: diagramTheme, svg });
        },
        () => {
          if (!cancelled)
            setResult({ source, theme: diagramTheme, error: true });
        },
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, diagramTheme]);

  return (
    <div className="code-block mermaid-block">
      <div className="code-heading">
        <span>Mermaid</span>
        <div className="mermaid-actions">
          {current?.svg && (
            <button
              type="button"
              aria-pressed={showSource}
              onClick={() => setShowSource(!showSource)}
            >
              {showSource ? "查看图表" : "查看源码"}
            </button>
          )}
          <IconButton
            icon={Copy}
            title="复制图表源码"
            onClick={() => copy(source)}
          />
        </div>
      </div>
      {current?.svg && !showSource ? (
        <div
          className="mermaid-diagram"
          role="img"
          aria-label="Mermaid 图表"
          dangerouslySetInnerHTML={{ __html: current.svg }}
        />
      ) : (
        <>
          {!current?.svg && (
            <p className="mermaid-status" role="status">
              {current?.error
                ? "图表暂时无法显示，源码可能尚未完整或存在语法错误。"
                : "正在绘制图表…"}
            </p>
          )}
          <pre>
            <code>{source}</code>
          </pre>
        </>
      )}
    </div>
  );
}
