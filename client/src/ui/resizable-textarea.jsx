import React, { useEffect, useRef, useState } from "react";
import { ResizeHandle } from "./resize-handle.jsx";

// 输入框沿用表单字段与草稿，手动高度仅在本次挂载期间保留。
export function ResizableTextarea({ style, disabled, ...props }) {
  const area = useRef(null);
  const drag = useRef(null);
  const [height, setHeight] = useState(null);
  const [layout, setLayout] = useState(null);
  function finish(event) {
    const current = drag.current;
    if (event?.pointerId !== undefined && current?.id !== event.pointerId)
      return;
    drag.current = null;
    if (current?.handle.hasPointerCapture(current.id))
      current.handle.releasePointerCapture(current.id);
  }
  function change(value) {
    const css = getComputedStyle(area.current);
    setHeight(
      Math.max(
        parseFloat(css.minHeight),
        Math.min(parseFloat(css.maxHeight), value),
      ),
    );
  }
  useEffect(() => {
    if (!area.current?.ownerDocument?.defaultView) return;
    const view = area.current.ownerDocument.defaultView;
    let previous;
    const measure = () => {
      const css = view.getComputedStyle(area.current);
      const next = {
        min: parseFloat(css.minHeight),
        max: parseFloat(css.maxHeight),
        height: area.current.getBoundingClientRect().height,
      };
      if (previous && (previous.min !== next.min || previous.max !== next.max))
        finish();
      previous = next;
      setLayout((current) =>
        current && Object.keys(next).every((key) => current[key] === next[key])
          ? current
          : next,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(area.current);
    measure();
    view.addEventListener("blur", finish);
    view.addEventListener("resize", finish);
    return () => {
      observer.disconnect();
      view.removeEventListener("blur", finish);
      view.removeEventListener("resize", finish);
      finish();
    };
  }, []);
  useEffect(() => {
    if (disabled) finish();
  }, [disabled]);
  return (
    <div className="resizable-textarea">
      <textarea
        {...props}
        disabled={disabled}
        ref={area}
        style={{ ...style, ...(height === null ? {} : { height }) }}
      />
      {!disabled && (
        <ResizeHandle
          direction="y"
          role="separator"
          tabIndex={0}
          aria-label="调整输入框高度"
          aria-orientation="horizontal"
          aria-valuemin={layout?.min}
          aria-valuemax={layout?.max}
          aria-valuenow={layout?.height}
          title="拖动或用方向键调整高度，双击或按 Home 恢复默认"
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              id: event.pointerId,
              handle: event.currentTarget,
              y: event.clientY,
              height: area.current.getBoundingClientRect().height,
            };
          }}
          onPointerMove={(event) => {
            const current = drag.current;
            if (current?.id === event.pointerId)
              change(current.height + event.clientY - current.y);
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
          onDoubleClick={() => {
            finish();
            setHeight(null);
          }}
          onKeyDown={(event) => {
            if (!["ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Home") setHeight(null);
            else
              change(
                area.current.getBoundingClientRect().height +
                  (event.key === "ArrowDown" ? 1 : -1) *
                    parseFloat(getComputedStyle(area.current).fontSize),
              );
          }}
        />
      )}
    </div>
  );
}
