import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

export const codeHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier], class: "hljs-keyword" },
  { tag: [tags.string, tags.regexp, tags.quote], class: "hljs-string" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], class: "hljs-number" },
  { tag: tags.comment, class: "hljs-comment" },
  { tag: [tags.typeName, tags.className, tags.namespace], class: "hljs-type" },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.definition(tags.variableName),
    ],
    class: "hljs-title",
  },
  { tag: [tags.propertyName, tags.attributeName], class: "hljs-attr" },
  { tag: [tags.meta, tags.processingInstruction], class: "hljs-meta" },
  { tag: tags.tagName, class: "hljs-selector-tag" },
  { tag: tags.heading, color: "var(--link)", fontWeight: "bold" },
  { tag: tags.link, color: "var(--link)", textDecoration: "underline" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
]);
