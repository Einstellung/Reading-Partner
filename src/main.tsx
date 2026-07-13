import React from "react";
import ReactDOM from "react-dom/client";
import { installFetchBridge } from "./ai/fetch-bridge";
import "./styles.css";

// The bridge must be in place before pi-ai (imported via App) initializes, in
// case the underlying SDK captures a reference to the global fetch at module
// load. Hence the dynamic import.
installFetchBridge();

void import("./App").then(({ default: App }) => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
