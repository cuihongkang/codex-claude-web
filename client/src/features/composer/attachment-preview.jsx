import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ImageViewer } from "../markdown/image-viewer.jsx";
import { useSurfaceResize } from "../../ui/surface-resize.jsx";

export function AttachmentPreview({ attachment, onClose }) {
  if (attachment.preview)
    return (
      <ImageViewer
        url={attachment.preview}
        alt={attachment.name}
        onClose={onClose}
      />
    );
  return <TextAttachmentPreview attachment={attachment} onClose={onClose} />;
}

function TextAttachmentPreview({ attachment, onClose }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!attachment.file) return;
    const value = URL.createObjectURL(attachment.file);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [attachment]);
  const { ref, style, handle } = useSurfaceResize({ id: "attachment" });
  useEffect(() => {
    const opener = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      style={style}
      className="attachment-text-preview"
      aria-label={"预览 " + attachment.name}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <strong>{attachment.name}</strong>
        <button type="button" onClick={onClose}>
          关闭预览
        </button>
      </header>
      <div className="attachment-preview-body">
        <p>
          {attachment.mime || "文件"}
          {attachment.size != null
            ? " · " + attachment.size.toLocaleString() + " 字节"
            : ""}
        </p>
        {attachment.kind === "text" ? (
          <pre>{attachment.text}</pre>
        ) : url && attachment.kind === "audio" ? (
          <audio src={url} controls onError={() => setFailed(true)} />
        ) : url && attachment.kind === "video" ? (
          <video src={url} controls onError={() => setFailed(true)} />
        ) : url && attachment.kind === "pdf" ? (
          <object data={url} type="application/pdf">
            <p>请下载 PDF 后查看。</p>
          </object>
        ) : (
          <p>
            {attachment.input?.text ||
              "此格式可下载后使用对应应用打开。发送后，代理可读取原始文件。"}
          </p>
        )}
        {failed && <p role="status">浏览器无法播放此格式，请下载后查看。</p>}
        {url && (
          <a href={url} download={attachment.name}>
            下载原始文件
          </a>
        )}
      </div>
      {handle}
    </dialog>,
    document.body,
  );
}
