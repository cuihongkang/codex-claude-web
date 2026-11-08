import { ResizeHandle } from "./resize-handle.jsx";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

function readSize(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value &&
      [value.width, value.height].every(
        (number) => Number.isFinite(number) && number > 0 && number <= 1,
      )
      ? value
      : null;
  } catch {
    return null;
  }
}

// 窗口尺寸按可用空间的比例保存，布局边界由所属容器的 CSS 定义。
export function useSurfaceResize({
  id,
  panel = false,
  active = true,
  anchored = false,
}) {
  const key = "cx-surface-size:" + id;
  const ref = useRef(null);
  const drag = useRef(null);
  const [size, setSize] = useState(() => readSize(key));
  const [limits, setLimits] = useState(null);

  function finish(event) {
    const current = drag.current;
    if (event?.pointerId !== undefined && current?.id !== event.pointerId)
      return;
    drag.current = null;
    if (current?.handle.hasPointerCapture(current.id))
      current.handle.releasePointerCapture(current.id);
  }

  function measure() {
    const node = ref.current;
    const box = node.getBoundingClientRect();
    const css = getComputedStyle(node);
    return {
      width: box.width,
      height: box.height,
      minWidth: parseFloat(css.minWidth) || 0,
      maxWidth: parseFloat(css.maxWidth),
      minHeight: parseFloat(css.minHeight) || 0,
      maxHeight: parseFloat(css.maxHeight) || innerHeight,
      availableWidth: panel ? node.parentElement.clientWidth : innerWidth,
      availableHeight: innerHeight,
    };
  }

  function change(width, height) {
    const bounds = measure();
    setSize({
      width:
        Math.max(bounds.minWidth, Math.min(bounds.maxWidth, width)) /
        bounds.availableWidth,
      height:
        Math.max(bounds.minHeight, Math.min(bounds.maxHeight, height)) /
        bounds.availableHeight,
    });
  }

  useEffect(() => {
    try {
      if (size) localStorage.setItem(key, JSON.stringify(size));
      else localStorage.removeItem(key);
    } catch {
      // 存储不可用时保留本页面中的尺寸选择。
    }
  }, [key, size]);

  useLayoutEffect(() => {
    if (!panel || !ref.current?.ownerDocument?.defaultView) return;
    const owner = ref.current.parentElement;
    if (size)
      owner.style.setProperty("--context-preferred", `${size.width * 100}cqw`);
    else owner.style.removeProperty("--context-preferred");
    return () => owner.style.removeProperty("--context-preferred");
  }, [panel, size]);

  useLayoutEffect(() => {
    if (!ref.current?.ownerDocument?.defaultView) return;
    let previousBounds;
    const update = () => {
      if (!ref.current.getClientRects().length) return;
      const next = measure();
      if (
        previousBounds &&
        [
          "minWidth",
          "maxWidth",
          "maxHeight",
          "availableWidth",
          "availableHeight",
        ].some((key) => previousBounds[key] !== next[key])
      )
        finish();
      previousBounds = next;
      setLimits((previous) =>
        previous &&
        Object.keys(next).every((key) => previous[key] === next[key])
          ? previous
          : next,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(ref.current);
    observer.observe(ref.current.parentElement);
    window.addEventListener("blur", finish);
    window.addEventListener("resize", finish);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("blur", finish);
      window.removeEventListener("resize", finish);
      finish();
    };
  }, []);

  useEffect(() => {
    if (!active) finish();
  }, [active]);

  const label = panel ? "调整对话详情宽度" : "调整窗口大小";
  const handle = (
    <ResizeHandle
      direction={panel ? "x" : "both"}
      className={
        "surface-resizer " +
        (panel ? "surface-resizer-left" : "surface-resizer-corner")
      }
      role={panel ? "separator" : "button"}
      aria-label={label}
      aria-orientation={panel ? "vertical" : undefined}
      aria-valuemin={panel ? limits?.minWidth : undefined}
      aria-valuemax={panel ? limits?.maxWidth : undefined}
      aria-valuenow={panel ? limits?.width : undefined}
      title="拖动或用方向键调整大小，双击或按 Home 恢复默认"
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          id: event.pointerId,
          handle: event.currentTarget,
          x: event.clientX,
          y: event.clientY,
          ...measure(),
        };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.id !== event.pointerId) return;
        // 居中窗口的边缘每移动一单位，完整尺寸变化两单位。
        change(
          start.width +
            (event.clientX - start.x) * (panel ? -1 : anchored ? 1 : 2),
          start.height + (event.clientY - start.y) * (anchored ? 1 : 2),
        );
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onDoubleClick={() => {
        finish();
        setSize(null);
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Home" ||
          (!panel && ["Enter", " "].includes(event.key))
        ) {
          event.preventDefault();
          event.stopPropagation();
          setSize(null);
          return;
        }
        const direction = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        }[event.key];
        if (!direction || (panel && direction[1])) return;
        event.preventDefault();
        event.stopPropagation();
        const current = measure();
        const step =
          parseFloat(getComputedStyle(ref.current).fontSize) *
          (event.shiftKey ? 4 : 1);
        change(
          current.width + direction[0] * step * (panel ? -1 : 1),
          current.height + direction[1] * step,
        );
      }}
    />
  );
  return {
    ref,
    style:
      !panel && size
        ? { width: `${size.width * 100}vw`, height: `${size.height * 100}dvh` }
        : undefined,
    handle,
  };
}

export function ResizableWindow({
  as: Tag = "section",
  resizeId,
  children,
  ...props
}) {
  const { ref, style, handle } = useSurfaceResize({ id: resizeId });
  return (
    <Tag {...props} ref={ref} style={style}>
      {children}
      {handle}
    </Tag>
  );
}
