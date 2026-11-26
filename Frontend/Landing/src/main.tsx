import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { startSmoothScroll } from "./motion/smoothScroll";
import { enhanceInteractions } from "./motion/interactions";
import "./fonts.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

startSmoothScroll();
enhanceInteractions(document);
