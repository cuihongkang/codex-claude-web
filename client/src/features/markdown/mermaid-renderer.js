let queue = Promise.resolve();
let nextId = 0;

export function renderMermaid(source, theme) {
  // Mermaid 使用全局配置，按图串行设置主题并完成渲染。
  const result = queue.then(async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme,
      fontFamily: "Inter, Noto Sans SC, sans-serif",
    });
    const container = document.createElement("div");
    container.className = "mermaid-render-target";
    document.body.append(container);
    try {
      const { svg } = await mermaid.render(
        `mermaid-${++nextId}`,
        source,
        container,
      );
      return svg;
    } finally {
      container.remove();
    }
  });
  queue = result.catch(() => {});
  return result;
}
