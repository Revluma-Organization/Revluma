import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import App from "@/App";

// House style: no em-dashes anywhere on the landing page.
const EM_DASH = /\u2014|&mdash;|&#8212;/;

describe("Landing copy style", () => {
  it("has no em-dashes in the homepage", () => {
    expect(readFileSync(resolve(__dirname, "../../../index.html"), "utf8")).not.toMatch(EM_DASH);
  });

  it("has no em-dashes in any rendered landing section", () => {
    const { container } = render(<App />);
    expect(container.innerHTML).not.toMatch(EM_DASH);
  });
});

// The user asked for every "read-only" mention to be removed from the landing page.
const READ_ONLY = /read[\s\u2010\u2011-]?only/i;

describe("Landing copy: no read-only mentions", () => {
  it("has no read-only wording in the homepage", () => {
    const html = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");
    expect(html.replace(/<!--[\s\S]*?-->/g, "")).not.toMatch(READ_ONLY);
  });

  it("has no read-only wording in any rendered landing section", () => {
    const { container } = render(<App />);
    expect(container.textContent).not.toMatch(READ_ONLY);
    for (const el of container.querySelectorAll("[aria-label],[title],[alt]")) {
      for (const attr of ["aria-label", "title", "alt"]) expect(el.getAttribute(attr) ?? "").not.toMatch(READ_ONLY);
    }
  });
});
