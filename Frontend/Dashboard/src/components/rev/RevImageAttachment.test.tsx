import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RevComposerAttachment, RevSentImage } from "./RevImageAttachment";

const SRC = "data:image/png;base64,iVBORw0KGgo=";

describe("RevComposerAttachment", () => {
  it("renders the thumbnail with a remove control", async () => {
    const onRemove = vi.fn();
    render(<RevComposerAttachment src={SRC} name="store.png" onRemove={onRemove} isDark={false} />);
    expect(screen.getByAltText("Attached image")).toHaveAttribute("src", SRC);
    fireEvent.click(screen.getByRole("button", { name: "Remove attachment" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("opens the image in a lightbox and closes it with Escape, returning focus", async () => {
    render(<RevComposerAttachment src={SRC} name="store.png" onRemove={() => {}} isDark />);
    const trigger = screen.getByRole("button", { name: "Preview attached image" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Attached image: store.png" });
    expect(dialog).toBeInTheDocument();
    expect(document.querySelector("[data-rev-lightbox-backdrop]")).not.toBeNull();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes from the close button and from a backdrop click", async () => {
    render(<RevComposerAttachment src={SRC} onRemove={() => {}} isDark={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview attached image" }));
    fireEvent.click(await screen.findByRole("button", { name: "Close image preview" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Preview attached image" }));
    const layer = document.querySelector("[data-rev-lightbox]") as HTMLElement;
    fireEvent.click(layer);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("RevSentImage", () => {
  it("opens the sent image in a lightbox", async () => {
    render(<RevSentImage src={SRC} isDark={false} />);
    fireEvent.click(screen.getByRole("button", { name: "View image you sent" }));
    expect(await screen.findByRole("dialog", { name: "Image you sent" })).toBeInTheDocument();
  });
});
