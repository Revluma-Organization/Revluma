import { useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

// Image attachments, ChatGPT style (ui-ux-pro-max study, Rev composer round):
//
// 1. The thumbnail lives INSIDE the composer, above the text field, and the
//    composer grows to hold it. Nothing floats outside the box.
// 2. Remove is a small dark circle on the thumbnail's corner. On hover-capable
//    pointers it appears on hover or keyboard focus; on touch it is always
//    visible. Its hit area is padded out to 44 px.
// 3. Tapping the thumbnail opens a lightbox: the image sits above everything,
//    the page behind is dimmed and blurred. Escape, the close button or a
//    click on the backdrop dismisses it, and focus returns to the thumbnail.
//    The Radix dialog primitive supplies the focus trap, scroll lock and
//    aria-hiding of the page behind.
// 4. Motion is short and transform-only (scale + opacity, expo-out), and
//    collapses to a plain fade under prefers-reduced-motion.

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export function RevImageLightbox({ src, alt, open, onClose, returnFocusRef }: {
  src: string; alt: string; open: boolean; onClose: () => void;
  /** The thumbnail that opened the lightbox; focus goes back to it on close. */
  returnFocusRef?: React.RefObject<HTMLElement>;
}) {
  const reduce = useReducedMotion();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={next => { if (!next) onClose(); }}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div data-rev-lightbox-backdrop=""
                className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-xl"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE_OUT }} />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount aria-describedby={undefined}
              onCloseAutoFocus={event => {
                const target = returnFocusRef?.current;
                if (target?.isConnected) { event.preventDefault(); target.focus(); }
              }}>
              <motion.div data-rev-lightbox=""
                className="fixed inset-0 z-[301] flex items-center justify-center p-4 outline-none sm:p-10"
                // The content layer fills the viewport so the image can centre;
                // a click on its empty area is a click on the backdrop.
                onClick={event => { if (event.target === event.currentTarget) onClose(); }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0.12 : 0.2 }}>
                <DialogPrimitive.Title className="sr-only">{alt}</DialogPrimitive.Title>
                <motion.img src={src} alt={alt} draggable={false}
                  className="max-h-[85vh] max-w-full select-none rounded-2xl object-contain shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
                  transition={{ duration: reduce ? 0.12 : 0.3, ease: EASE_OUT }} />
                <DialogPrimitive.Close aria-label="Close image preview" title="Close"
                  className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-5 sm:top-5">
                  <X size={20} strokeWidth={2.2} />
                </DialogPrimitive.Close>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

/** The pending attachment, shown inside the composer above the text field. */
export function RevComposerAttachment({ src, name, onRemove, isDark }: {
  src: string; name?: string; onRemove: () => void; isDark: boolean;
}) {
  const [open, setOpen] = useState(false);
  const thumbRef = useRef<HTMLButtonElement>(null);
  return (
    <div data-rev-composer-attachment="" className="px-3 pt-3">
      <div className="group/att relative inline-block align-top">
        <button ref={thumbRef} type="button" onClick={() => setOpen(true)}
          aria-label="Preview attached image" title={name || "Preview image"}
          className="block h-24 w-24 overflow-hidden rounded-2xl border transition-transform duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6F66FF] focus-visible:ring-offset-2 sm:h-28 sm:w-28"
          style={{ borderColor: isDark ? "#262626" : "#E8E6E1", background: isDark ? "#171717" : "#F4F3F0",
            ["--tw-ring-offset-color" as string]: isDark ? "#0D0D0D" : "#ffffff" }}>
          <img src={src} alt="Attached image" draggable={false}
            className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover/att:scale-[1.03]" />
        </button>
        <button type="button" onClick={onRemove} aria-label="Remove attachment" title="Remove"
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/75 text-white shadow-sm backdrop-blur-sm transition-opacity duration-150 before:absolute before:-inset-2.5 before:content-[''] hover:bg-black focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/att:opacity-100 [@media(hover:hover)]:group-focus-within/att:opacity-100">
          <X size={13} strokeWidth={2.6} />
        </button>
      </div>
      <RevImageLightbox src={src} alt={name ? `Attached image: ${name}` : "Attached image"} open={open} onClose={() => setOpen(false)} returnFocusRef={thumbRef} />
    </div>
  );
}

/** An image the merchant sent, shown above their question in the thread. */
export function RevSentImage({ src, isDark }: { src: string; isDark: boolean }) {
  const [open, setOpen] = useState(false);
  const thumbRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={thumbRef} type="button" onClick={() => setOpen(true)} aria-label="View image you sent"
        data-rev-sent-image=""
        className="group/sent block overflow-hidden rounded-2xl border transition-transform duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6F66FF]"
        style={{ borderColor: isDark ? "#262626" : "#E8E6E1", background: isDark ? "#171717" : "#F4F3F0" }}>
        <img src={src} alt="Image you sent" draggable={false}
          className="block max-h-60 w-auto max-w-[min(15rem,70vw)] object-cover transition-transform duration-300 ease-out group-hover/sent:scale-[1.02]" />
      </button>
      <RevImageLightbox src={src} alt="Image you sent" open={open} onClose={() => setOpen(false)} returnFocusRef={thumbRef} />
    </>
  );
}
