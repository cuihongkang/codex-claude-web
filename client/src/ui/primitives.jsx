import React from "react";
import { Folder } from "lucide-react";
export const IconButton = ({
  icon: Icon,
  title,
  onClick,
  active = false,
  ...props
}) => (
  <button
    className={"icon-button" + (active ? " active" : "")}
    title={title}
    aria-label={title}
    onClick={onClick}
    {...props}
  >
    <Icon size={17} />
  </button>
);
export const Empty = ({ icon: Icon = Folder, title, children }) => (
  <div className="empty-state">
    <Icon size={28} strokeWidth={1.3} />
    <strong>{title}</strong>
    {children && <p>{children}</p>}
  </div>
);
