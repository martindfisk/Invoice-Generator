import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { store } from "./store";
import "./theme.css";

document.documentElement.dataset.theme = store.getState().theme;

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
