/**
 * Entry for /waitlist (Frontend/waitlist.html). Built with the homepage embed
 * by `npm run build:embed` into Frontend/landing-hero/waitlist.js. Styles are
 * added to the document before the first render, so nothing paints unstyled.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import fontCss from "../fonts.css?inline";
import pageCss from "./waitlist.css?inline";
import { WaitlistApp } from "./WaitlistApp";

function addStyle(id: string, css: string) {
  if (document.querySelector(`style[data-${id}]`)) return;
  const style = document.createElement("style");
  style.setAttribute(`data-${id}`, "");
  style.textContent = css;
  document.head.appendChild(style);
}

const host = document.getElementById("revluma-waitlist");
if (host) {
  addStyle("revluma-fonts", fontCss);
  addStyle("revluma-waitlist", pageCss);
  createRoot(host).render(
    <StrictMode>
      <WaitlistApp />
    </StrictMode>,
  );
  host.removeAttribute("data-pending");
}
