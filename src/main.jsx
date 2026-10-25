import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Inter, served from this site's own files (OFL-licensed @fontsource package): no request to Google Fonts, and the look no longer depends on Pera's dialog.
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
