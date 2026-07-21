import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/archivo/400.css";
import "@fontsource/archivo/500.css";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/700.css";
import { App } from "./App.js";
import "./styles.css";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Frontend root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
