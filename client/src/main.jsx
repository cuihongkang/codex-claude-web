import React from "react";
import { createRoot } from "react-dom/client";
import { App, ErrorBoundary } from "./app/app.jsx";
import { AuthenticationGate } from "./app/auth.jsx";
import "@xterm/xterm/css/xterm.css";
import "./style.css";
createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <AuthenticationGate>
      <App />
    </AuthenticationGate>
  </ErrorBoundary>,
);
