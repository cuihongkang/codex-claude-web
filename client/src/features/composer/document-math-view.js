import katex from "katex";
import { $view } from "@milkdown/kit/utils";
import { TextSelection } from "@milkdown/kit/prose/state";
import { closeHistory } from "@milkdown/kit/prose/history";
import { documentMathSchema } from "./document-math-schema.js";

export const documentMathView = $view(
  documentMathSchema.node,
  () => (node, view, getPos) => {
    const dom = document.createElement("span");
    dom.className = "document-math-inline";
    dom.dataset.type = "math_inline";
    dom.contentEditable = "false";
    dom.tabIndex = 0;
    dom.setAttribute("role", "button");
    dom.setAttribute("aria-label", "编辑公式");
    dom.title = "双击或按 Enter 编辑公式";
    let current = node;
    function render() {
      dom.dataset.value = current.attrs.value;
      katex.render(current.attrs.value, dom, {
        displayMode: false,
        throwOnError: false,
        trust: false,
      });
    }
    function edit() {
      const position = getPos();
      if (position === undefined || !view.editable) return;
      const text = "$$" + current.attrs.value;
      const tr = closeHistory(view.state.tr).insertText(
        text,
        position,
        position + current.nodeSize,
      );
      view.dispatch(
        tr
          .setSelection(TextSelection.create(tr.doc, position + text.length))
          .scrollIntoView(),
      );
      view.focus();
    }
    dom.ondblclick = edit;
    dom.onkeydown = (event) => {
      if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        edit();
      }
    };
    render();
    return {
      dom,
      update(next) {
        if (next.type !== current.type) return false;
        current = next;
        render();
        return true;
      },
      ignoreMutation: () => true,
      stopEvent: (event) =>
        event.type === "dblclick" ||
        (event.type === "keydown" &&
          event.key === "Enter" &&
          !event.ctrlKey &&
          !event.metaKey),
    };
  },
);
