import { $nodeSchema, $remark } from "@milkdown/kit/utils";
import remarkMath from "remark-math";

function inlineMathTree(node, file) {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    if (child.type === "math") {
      const raw = String(file.value).slice(
        child.position.start.offset,
        child.position.end.offset,
      );
      if (!/\n\s*\$\$\s*$/.test(raw))
        return { type: "paragraph", children: [{ type: "text", value: raw }] };
      return {
        type: "paragraph",
        children: [
          {
            type: "inlineMath",
            value: child.value.trim().replace(/\s*\n\s*/g, " "),
          },
        ],
      };
    }
    inlineMathTree(child, file);
    return child;
  });
}

export const documentMathParser = $remark(
  "documentMathParser",
  () =>
    function () {
      remarkMath.call(this, { singleDollarTextMath: false });
      this.data().toMarkdownExtensions.push({
        handlers: { inlineMath: (node) => "$$" + node.value + "$$" },
      });
      return inlineMathTree;
    },
);

export const documentMathSchema = $nodeSchema("math_inline", () => ({
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  attrs: { value: { default: "" } },
  parseDOM: [
    {
      tag: 'span[data-type="math_inline"]',
      getAttrs: (dom) => ({ value: dom.dataset.value }),
    },
  ],
  toDOM: (node) => [
    "span",
    { "data-type": "math_inline", "data-value": node.attrs.value },
  ],
  parseMarkdown: {
    match: (node) => node.type === "inlineMath",
    runner: (state, node, type) => state.addNode(type, { value: node.value }),
  },
  toMarkdown: {
    match: (node) => node.type.name === "math_inline",
    runner: (state, node) =>
      state.addNode("inlineMath", undefined, node.attrs.value),
  },
}));
