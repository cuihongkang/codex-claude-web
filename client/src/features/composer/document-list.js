import { $view } from "@milkdown/kit/utils";
import { listItemSchema } from "@milkdown/kit/preset/commonmark";

export const documentList = $view(
  listItemSchema.node,
  () => (node, view, getPos) => {
    const dom = document.createElement("li");
    const contentDOM = document.createElement("div");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.contentEditable = "false";
    checkbox.setAttribute("aria-label", "完成任务");
    dom.append(contentDOM);
    let current = node;
    function update(next) {
      if (next.type !== current.type) return false;
      current = next;
      const task = next.attrs.checked != null;
      dom.classList.toggle("document-task", task);
      if (task) {
        dom.prepend(checkbox);
        checkbox.checked = next.attrs.checked;
        checkbox.disabled = !view.editable;
      } else checkbox.remove();
      return true;
    }
    checkbox.onmousedown = (event) => event.preventDefault();
    checkbox.onchange = () => {
      const position = getPos();
      if (position === undefined || !view.editable) return;
      view.dispatch(
        view.state.tr.setNodeAttribute(position, "checked", checkbox.checked),
      );
    };
    update(node);
    return {
      dom,
      contentDOM,
      update,
      stopEvent: (event) => event.target === checkbox,
      ignoreMutation: (mutation) =>
        mutation.type !== "selection" && !contentDOM.contains(mutation.target),
    };
  },
);
