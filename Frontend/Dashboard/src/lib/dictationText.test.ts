import { describe, expect, it } from "vitest";
import { appendInterim, appendPhrase, cleanSpoken, finishSentence } from "./dictationText";

const phrases = (...parts: string[]) => parts.reduce(appendPhrase, "");

describe("dictation formatting", () => {
  it("turns raw recognised words into written prose", () => {
    expect(phrases("hello um what's currently going on and um how are you doing I I'm"))
      .toBe("Hello, what's currently going on and how are you doing I'm?");
    expect(phrases("show me orders from last week")).toBe("Show me orders from last week.");
    expect(phrases("hey rev which products are selling best this week")).toBe("Hey Rev, which products are selling best this week?");
  });

  it("splits phrases into sentences and joins continuations", () => {
    expect(phrases("hello", "how are you doing")).toBe("Hello, how are you doing?");
    expect(phrases("hello there")).toBe("Hello there.");
    expect(phrases("hi rev")).toBe("Hi Rev.");
    expect(phrases("what changed this week", "and why")).toBe("What changed this week? And why?");
    expect(phrases("revenue dropped this week", "but orders grew")).toBe("Revenue dropped this week, but orders grew.");
    expect(phrases("sales are up", "what about refunds")).toBe("Sales are up. What about refunds?");
  });

  it("continues text the merchant typed", () => {
    expect(appendPhrase("Why did", "revenue drop")).toBe("Why did revenue drop?");
    expect(appendPhrase("Quick question.", "is shipping slow")).toBe("Quick question. Is shipping slow?");
  });

  it("honours spoken punctuation and drops fillers and stutters", () => {
    expect(cleanSpoken("um the the store is doing well comma thanks")).toBe("the store is doing well, thanks");
    expect(phrases("is it possible question mark")).toBe("Is it possible?");
    expect(phrases("that's amazing exclamation point")).toBe("That's amazing!");
    expect(phrases("i think i'm done")).toBe("I think I'm done.");
    expect(cleanSpoken("I had had enough")).toBe("I had had enough");
  });

  it("leaves real words that look like commands or fillers alone", () => {
    expect(phrases("launch a new line of products this period")).toBe("Launch a new line of products this period.");
    expect(phrases("umbrella sales are up")).toBe("Umbrella sales are up.");
  });

  it("closes an unfinished last sentence only when needed", () => {
    expect(finishSentence("How are you doing? I'm doing great")).toBe("How are you doing? I'm doing great.");
    expect(finishSentence("Sales are up. Why is that")).toBe("Sales are up. Why is that?");
    expect(finishSentence("Done.")).toBe("Done.");
    expect(finishSentence("")).toBe("");
  });

  it("shows the live phrase without an ending yet", () => {
    expect(appendInterim("", "hello what is")).toBe("Hello, what is");
    expect(appendInterim("Sales are up.", "what about")).toBe("Sales are up. What about");
    expect(appendInterim("Why did", "revenue")).toBe("Why did revenue");
  });
});
