import React, { createContext, useContext, memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import "katex/dist/katex.min.css";
import { Copy } from "lucide-react";
import { copy } from "../../store.js";
import { MermaidBlock } from "./mermaid-block.jsx";
import { MessageImage } from "./message-image.jsx";
import { MessageLink } from "./message-link.jsx";
import { messageUrlTransform } from "../../domain/image-source.js";
import { remarkAnnotations } from "../../domain/annotations.js";
import {
  AnnotationReference,
  AnnotationContext,
} from "../annotations/message-annotations.jsx";
import { MarkdownPicture } from "./markdown-picture.jsx";

const DirectoryContext = createContext(undefined);

const htmlSchema = {
  ...defaultSchema,
  tagNames: [...defaultSchema.tagNames, "annotation-ref"],
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
    source: ["srcSet", "media", "type", "sizes"],
    "annotation-ref": ["index"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...defaultSchema.protocols.href, "file", "sandbox"],
    src: [...defaultSchema.protocols.src, "file", "sandbox", "data"],
  },
  strip: [...defaultSchema.strip, "style", "iframe", "object", "embed"],
};

function MarkdownImage(props) {
  const cwd = useContext(DirectoryContext);
  return <MessageImage {...props} cwd={cwd} />;
}

function MarkdownLink(props) {
  const cwd = useContext(DirectoryContext);
  return <MessageLink {...props} cwd={cwd} />;
}

function Picture(props) {
  const cwd = useContext(DirectoryContext);
  return <MarkdownPicture {...props} cwd={cwd} />;
}

function mathDelimiters(text) {
  return (text || "")
    .split(
      /(\x60\x60\x60[\s\S]*?\x60\x60\x60|~~~[\s\S]*?~~~|\x60[^\x60]*\x60)/g,
    )
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => "$" + math + "$")
            .replace(
              /\\\[([\s\S]*?)\\\]/g,
              (_, math) => "\n$$\n" + math + "\n$$\n",
            ),
    )
    .join("");
}

export const RichText = memo(
  function RichText({ text, annotations = [], cwd }) {
    return (
      <div className="markdown">
        <DirectoryContext.Provider value={cwd}>
          <AnnotationContext.Provider value={annotations}>
            <Markdown
              urlTransform={messageUrlTransform}
              remarkPlugins={[remarkGfm, remarkMath, remarkAnnotations]}
              rehypePlugins={[
                rehypeRaw,
                [rehypeSanitize, htmlSchema],
                [rehypeSlug, { prefix: "user-content-" }],
                rehypeKatex,
                [rehypeHighlight, { plainText: ["mermaid"] }],
              ]}
              components={{
                a: MarkdownLink,
                pre: CodeBlock,
                img: MarkdownImage,
                picture: Picture,
                "annotation-ref": AnnotationReference,
              }}
            >
              {mathDelimiters(text)}
            </Markdown>
          </AnnotationContext.Provider>
        </DirectoryContext.Provider>
      </div>
    );
  },
  (previous, next) =>
    previous.text === next.text &&
    previous.cwd === next.cwd &&
    JSON.stringify(previous.annotations || []) ===
      JSON.stringify(next.annotations || []),
);

function CodeBlock({ children }) {
  const language = children?.props?.className?.match(/language-([\w-]+)/)?.[1];
  const source = extractText(children);
  if (language === "mermaid") return <MermaidBlock source={source} />;
  return (
    <div className="code-block">
      <div className="code-heading">
        <span>{language || "代码"}</span>
        <button
          className="icon-button"
          title="复制代码"
          aria-label="复制代码"
          onClick={() => copy(source)}
        >
          <Copy size={17} />
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function extractText(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  return node?.props ? extractText(node.props.children) : "";
}
