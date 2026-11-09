// 引用只转换 Markdown 正文节点，链接、代码、公式及 HTML 保留原语义。
export function remarkFileReferences({ references = [] } = {}) {
  const ordered = references
    .map((file, index) => ({ file, index }))
    .sort((a, b) => b.file.name.length - a.file.name.length);
  const used = new Set();
  const referenceNode = (index) => ({
    type: "fileReference",
    data: { hName: "file-ref", hProperties: { index: String(index) } },
  });
  function transform(node) {
    if (
      !node.children ||
      [
        "code",
        "inlineCode",
        "math",
        "inlineMath",
        "html",
        "link",
        "linkReference",
        "image",
      ].includes(node.type)
    )
      return;
    node.children = node.children.flatMap((child) => {
      if (child.type !== "text") {
        transform(child);
        return [child];
      }
      const parts = [];
      let offset = 0;
      for (let position = 0; position < child.value.length; position++) {
        if (child.value[position] !== "@") continue;
        const match = ordered.find(({ file }) =>
          child.value.startsWith("@" + file.name, position),
        );
        if (!match) continue;
        if (position > offset)
          parts.push({
            type: "text",
            value: child.value.slice(offset, position),
          });
        parts.push(referenceNode(match.index));
        used.add(match.index);
        position += match.file.name.length;
        offset = position + 1;
      }
      if (!offset) return [child];
      if (offset < child.value.length)
        parts.push({ type: "text", value: child.value.slice(offset) });
      return parts;
    });
  }
  return (root) => {
    used.clear();
    transform(root);
    const remaining = references.flatMap((_, index) =>
      used.has(index) ? [] : [referenceNode(index)],
    );
    if (remaining.length)
      root.children.push({
        type: "unusedFileReferences",
        data: { hName: "file-reference-list" },
        children: remaining,
      });
  };
}
