import { Crepe } from "@milkdown/crepe";
import {
  editorViewCtx,
  serializerCtx,
  remarkStringifyOptionsCtx,
  editorViewOptionsCtx,
} from "@milkdown/kit/core";
import { syntaxHighlighting } from "@codemirror/language";
import { linkSchema } from "@milkdown/kit/preset/commonmark";
import { codeHighlightStyle } from "../markdown/code-highlight-style.js";
import { Plugin } from "@milkdown/kit/prose/state";
import { $prose, replaceAll } from "@milkdown/kit/utils";
import {
  documentInputRules,
  documentLinkRule,
} from "./document-input-rules.js";
import { documentCursor, selectDocumentPosition } from "./editor-selection.js";
import { documentList } from "./document-list.js";
import { documentMathInput } from "./document-math-input.js";
import {
  documentMathParser,
  documentMathSchema,
} from "./document-math-schema.js";
import { documentMathView } from "./document-math-view.js";

function serializeDraft(doc, serialize) {
  let size = doc.content.size;
  let trailing = 0;
  for (let index = doc.childCount - 1; index >= 0; index--) {
    const child = doc.child(index);
    if (child.type.name !== "paragraph" || child.content.size) break;
    size -= child.nodeSize;
    trailing++;
  }
  if (!size) return "";
  return (
    serialize(doc.copy(doc.content.cut(0, size))).replace(/\n$/, "") +
    "\n".repeat(trailing)
  );
}

export async function createDocumentEditor(
  parent,
  { value, onChange, placeholder },
) {
  let suppressed = false;
  let destroyed = false;
  const crepe = new Crepe({
    root: parent,
    defaultValue: value,
    features: {
      [Crepe.Feature.BlockEdit]: false,
      [Crepe.Feature.TopBar]: false,
      [Crepe.Feature.Table]: false,
      [Crepe.Feature.ListItem]: false,
      [Crepe.Feature.ImageBlock]: false,
      [Crepe.Feature.Latex]: false,
    },
    featureConfigs: {
      [Crepe.Feature.Cursor]: { virtual: false },
      [Crepe.Feature.Placeholder]: { text: placeholder, mode: "doc" },
      [Crepe.Feature.Toolbar]: {
        boldLabel: "加粗",
        italicLabel: "斜体",
        codeLabel: "行内代码",
        linkLabel: "链接",
        strikethroughLabel: "删除线",
        latexLabel: "公式",
      },
      [Crepe.Feature.LinkTooltip]: { inputPlaceholder: "输入链接" },
      [Crepe.Feature.CodeMirror]: {
        theme: [],
        copyText: "复制",
        searchPlaceholder: "搜索语言",
        noResultText: "没有匹配语言",
        previewLabel: "预览",
        previewLoading: "正在绘制…",
        previewToggleText: (only) => (only ? "编辑" : "收起预览"),
      },
    },
  });
  crepe.editor
    .config((ctx) => {
      ctx.update(linkSchema.key, (schema) => (ctx) => ({
        ...schema(ctx),
        inclusive: false,
      }));
      ctx.update(editorViewOptionsCtx, (previous) => ({
        ...previous,
        ...documentMathInput(),
      }));
      ctx.set("CodeMirrorThemeCtx", [syntaxHighlighting(codeHighlightStyle)]);
      ctx.update(remarkStringifyOptionsCtx, (previous) => ({
        ...previous,
        bullet: "-",
        emphasis: "*",
        strong: "*",
        fences: true,
      }));
    })
    .use(documentInputRules)
    .use(documentLinkRule)
    .use(documentList)
    .use(documentMathParser)
    .use(documentMathSchema)
    .use(documentMathView)
    .use(
      $prose(
        (ctx) =>
          new Plugin({
            view: () => ({
              update(view, previous) {
                if (
                  !suppressed &&
                  !destroyed &&
                  !view.state.doc.eq(previous.doc)
                )
                  onChange(
                    serializeDraft(view.state.doc, ctx.get(serializerCtx)),
                  );
              },
            }),
          }),
      ),
    );
  try {
    await crepe.create();
  } catch (error) {
    await crepe.destroy();
    throw error;
  }
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx));
  const serialize = crepe.editor.action((ctx) => ctx.get(serializerCtx));
  return {
    dom: view.dom,
    focus() {
      view.focus();
    },
    getCursor(end = false) {
      return documentCursor(view, serialize, end);
    },
    setCursor(start, end = start) {
      selectDocumentPosition(view, serialize, start, end);
    },
    setText(text) {
      suppressed = true;
      try {
        crepe.editor.action(replaceAll(text, !text));
      } finally {
        suppressed = false;
      }
    },
    setAttributes(attributes) {
      view.setProps({ attributes });
      crepe.editor.action((ctx) =>
        ctx.update("placeholderConfigCtx", (previous) => ({
          ...previous,
          text: attributes["data-placeholder"],
        })),
      );
    },
    destroy() {
      destroyed = true;
      return crepe.destroy();
    },
  };
}
