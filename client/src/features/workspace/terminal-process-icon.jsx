import React from "react";
import { TerminalSquare, Hexagon } from "lucide-react";
import pythonIcon from "../../assets/python.svg";

export function processLabel(name) {
  if (!name) return "Shell";
  if (/^python(?:\d+(?:\.\d+)*)?$/.test(name)) return "Python";
  return name;
}

export function TerminalProcessIcon({ name }) {
  if (processLabel(name) === "Python")
    return <img src={pythonIcon} alt="" className="terminal-process-icon" />;
  const Icon = name === "node" ? Hexagon : TerminalSquare;
  return <Icon size={16} strokeWidth={1.5} aria-hidden="true" />;
}
