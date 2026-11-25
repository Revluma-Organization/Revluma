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
