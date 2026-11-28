import { useEffect, useRef, useState, type ChangeEvent, type FC } from "react";
import { AlertCircle, ImageUp, Loader2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AVATAR_ACCEPT, AVATAR_HINT, validateAvatarFile } from "@/lib/profileSettings";
import { settingsUi as ui } from "@/lib/settingsStyles";
import { cn } from "@/lib/utils";

interface ProfilePhotoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUrl: string | null;
  initials: string;
  /** Resolves with an error message, or null on success. */
  onUpload: (file: File) => Promise<string | null>;
  onRemove: () => Promise<string | null>;
}

/**
 * Google-Account-style photo flow: a large preview, choose a file, review it,
 * then explicitly save. Nothing uploads until "Save photo".
 */
export const ProfilePhotoDialog: FC<ProfilePhotoDialogProps> = ({ open, onOpenChange, currentUrl, initials, onUpload, onRemove }) => {
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) return;
    setPendingFile(null);
    setError(null);
    setBusy(null);
  }, [open]);

  useEffect(() => {
    if (!pendingFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  const choose = () => {
    if (!busy) inputRef.current?.click();
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const invalid = validateAvatarFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setPendingFile(file);
  };

  const save = async () => {
    if (!pendingFile || busy) return;
    setBusy("upload");
    setError(null);
    const failure = await onUpload(pendingFile);
    setBusy(null);
    if (failure) setError(failure);
    else onOpenChange(false);
  };

  const remove = async () => {
    if (busy) return;
    setBusy("remove");
    setError(null);
    const failure = await onRemove();
    setBusy(null);
    if (failure) setError(failure);
    else onOpenChange(false);
  };

  const shown = previewUrl ?? currentUrl;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className={cn(ui.dialog, "max-w-[460px]")} onOpenAutoFocus={(event) => { event.preventDefault(); primaryRef.current?.focus(); }}>
        <div className="px-6 pb-1 pt-5">
          <DialogTitle className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Profile photo</DialogTitle>
          <DialogDescription className="mt-1 text-[13px] leading-5 text-ink-muted">
            Your photo appears in the sidebar, team lists, activity and Rev conversations.
          </DialogDescription>
        </div>

        <div className="flex flex-col items-center gap-4 px-6 py-6">
          <button
            type="button"
            onClick={choose}
            disabled={Boolean(busy)}
            aria-label="Choose a new photo"
            className={cn(
              "group relative h-40 w-40 cursor-pointer overflow-hidden rounded-full border border-line bg-brand-soft shadow-[0_8px_24px_-12px_rgba(16,24,40,0.35)] disabled:cursor-progress",
              ui.focusRing,
              "focus-visible:rounded-full",
            )}
          >
            {shown ? (
              <img src={shown} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[44px] font-semibold tracking-[-0.03em] text-brand-deep" aria-hidden="true">
                {initials}
              </span>
            )}
            <span
              className={cn(
                "absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity",
                busy ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
              )}
              aria-hidden="true"
            >
              {busy ? <Loader2 className="h-7 w-7 animate-spin" /> : <ImageUp className="h-7 w-7" />}
            </span>
          </button>
          <p className="max-w-[18rem] text-center text-[12.5px] leading-5 text-ink-muted">
            {pendingFile ? "Looks good? Save it to update your photo everywhere." : AVATAR_HINT}
          </p>
          {error ? (
            <p role="alert" className={cn(ui.fieldError, "text-center")}><AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{error}</p>
          ) : null}
          <input
            ref={inputRef}
            type="file"
            accept={AVATAR_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="profile-photo-input"
            onChange={handleFile}
          />
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-line bg-subtle px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {currentUrl && !pendingFile ? (
              <button type="button" onClick={() => void remove()} disabled={Boolean(busy)} className={ui.dangerGhostButton}>
                {busy === "remove" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                {busy === "remove" ? "Removing…" : "Remove photo"}
              </button>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {pendingFile ? (
              <>
                <button type="button" onClick={choose} disabled={Boolean(busy)} className={ui.secondaryButton}>Choose another</button>
                <button type="button" onClick={() => void save()} disabled={Boolean(busy)} className={ui.primaryButton}>
                  {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  {busy === "upload" ? "Saving…" : "Save photo"}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => onOpenChange(false)} disabled={Boolean(busy)} className={ui.secondaryButton}>Cancel</button>
                <button ref={primaryRef} type="button" onClick={choose} disabled={Boolean(busy)} className={ui.primaryButton}>
                  <ImageUp className="h-4 w-4" aria-hidden="true" /> {currentUrl ? "Upload new photo" : "Upload photo"}
                </button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
