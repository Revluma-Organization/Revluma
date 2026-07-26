import { FC, useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ShieldAlert,
  Trash2,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  X,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TransferFeedbackState {
  type: "success" | "error" | null;
  message: string;
}

export const DangerZone: FC = () => {
  const [transferEmail, setTransferEmail] = useState<string>("");
  const [transferFeedback, setTransferFeedback] = useState<TransferFeedbackState>({
    type: null,
    message: "",
  });
  const [isTransferring, setIsTransferring] = useState<boolean>(false);

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState<string>("");
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [isDeletedSuccess, setIsDeletedSuccess] = useState<boolean>(false);

  const handleTransferOwnership = (e: FormEvent) => {
    e.preventDefault();
    if (!transferEmail || !transferEmail.includes("@")) {
      setTransferFeedback({
        type: "error",
        message: "Please enter a valid email address.",
      });
      return;
    }

    setIsTransferring(true);
    setTransferFeedback({ type: null, message: "" });

    // Simulate transfer request with zero-defect handling
    setTimeout(() => {
      setIsTransferring(false);
      setTransferFeedback({
        type: "success",
        message: `Ownership transfer invitation sent to ${transferEmail}.`,
      });
      setTransferEmail("");
    }, 1000);
  };

  const handleOpenDeleteModal = () => {
    setDeleteConfirmText("");
    setIsDeletedSuccess(false);
    setIsDeleteModalOpen(true);
  };

  const handleCloseDeleteModal = () => {
    if (isDeleting) return;
    setIsDeleteModalOpen(false);
    setDeleteConfirmText("");
  };

  const handleConfirmDelete = () => {
    if (deleteConfirmText !== "DELETE") return;
    setIsDeleting(true);

    setTimeout(() => {
      setIsDeleting(false);
      setIsDeletedSuccess(true);
      setTimeout(() => {
        setIsDeleteModalOpen(false);
        setDeleteConfirmText("");
        setIsDeletedSuccess(false);
      }, 2000);
    }, 1200);
  };

  return (
    <div className="min-h-[calc(100vh-140px)] w-full rounded-2xl bg-slate-950 p-6 text-slate-100 shadow-2xl sm:p-8 md:p-10">
      <div className="mx-auto max-w-4xl space-y-8">
        {/* Page Header */}
        <div className="border-b border-red-500/40 pb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/15 text-red-500 ring-1 ring-red-500/40">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Danger Zone
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Manage irreversible actions, workspace ownership transfers, and permanent data deletion.
              </p>
            </div>
          </div>
        </div>

        {/* Section 1: Transfer Ownership */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="rounded-2xl border border-red-500/50 bg-slate-900/50 p-6 shadow-lg shadow-red-950/20 transition-all duration-300 hover:border-red-500 sm:p-8"
        >
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-start">
            <div className="space-y-2 md:max-w-xl">
              <div className="flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-red-400" />
                <h2 className="text-lg font-semibold text-white sm:text-xl">
                  Transfer Ownership
                </h2>
              </div>
              <p className="text-sm leading-relaxed text-slate-400">
                Transferring workspace ownership will grant full administrative and billing rights to another user. You will lose owner-level privileges immediately once the transfer is accepted.
              </p>
            </div>

            <form
              onSubmit={handleTransferOwnership}
              className="flex w-full flex-col gap-3 sm:flex-row md:w-auto md:min-w-[340px]"
            >
              <div className="flex-1">
                <Label htmlFor="transfer-email" className="sr-only">
                  Recipient Email
                </Label>
                <Input
                  id="transfer-email"
                  type="email"
                  value={transferEmail}
                  onChange={(e) => setTransferEmail(e.target.value)}
                  placeholder="new.owner@company.com"
                  className="h-10 w-full border-slate-700 bg-slate-950/80 text-slate-100 placeholder:text-slate-500 focus-visible:ring-red-500/50"
                  disabled={isTransferring}
                />
              </div>
              <Button
                type="submit"
                variant="destructive"
                disabled={isTransferring}
                className="h-10 whitespace-nowrap bg-red-600 hover:bg-red-700 text-white px-5 font-semibold shadow-lg shadow-red-600/30 active:scale-[0.98]"
              >
                {isTransferring ? "Transferring..." : "Transfer Workspace"}
              </Button>
            </form>
          </div>

          {/* Feedback banner for transfer action */}
          <AnimatePresence>
            {transferFeedback.type && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: "auto", marginTop: 16 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
                  transferFeedback.type === "success"
                    ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border border-red-500/30 bg-red-500/10 text-red-300"
                }`}
              >
                {transferFeedback.type === "success" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                )}
                <span>{transferFeedback.message}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        {/* Section 2: Delete Workspace */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          className="rounded-2xl border border-red-500/50 bg-slate-900/50 p-6 shadow-lg shadow-red-950/20 transition-all duration-300 hover:border-red-500 sm:p-8"
        >
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div className="space-y-2 md:max-w-xl">
              <div className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-red-400" />
                <h2 className="text-lg font-semibold text-white sm:text-xl">
                  Delete Workspace
                </h2>
              </div>
              <p className="text-sm leading-relaxed text-slate-400">
                Once you delete a workspace, there is no going back. All customer profiles, cart recovery workflows, integrations, analytics data, and historical logs will be permanently erased immediately.
              </p>
            </div>

            <div className="flex shrink-0">
              <Button
                type="button"
                variant="destructive"
                onClick={handleOpenDeleteModal}
                className="h-10 w-full whitespace-nowrap bg-red-600 hover:bg-red-700 text-white px-6 font-semibold shadow-lg shadow-red-600/30 active:scale-[0.98] sm:w-auto"
              >
                Delete Workspace
              </Button>
            </div>
          </div>
        </motion.section>
      </div>

      {/* Framer Motion Confirmation Modal */}
      <AnimatePresence>
        {isDeleteModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                handleCloseDeleteModal();
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{
                type: "spring",
                stiffness: 300,
                damping: 28,
              }}
              className="relative w-full max-w-md overflow-hidden rounded-2xl border border-red-500/60 bg-slate-950 p-6 text-slate-100 shadow-2xl sm:p-8"
            >
              {/* Close Icon Button */}
              <button
                type="button"
                onClick={handleCloseDeleteModal}
                disabled={isDeleting}
                className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-50"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-red-500 ring-1 ring-red-500/40">
                  <AlertTriangle className="h-7 w-7" />
                </div>
                <h3 className="mt-4 text-xl font-bold text-white">
                  Permanently Delete Workspace?
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  This action is permanent and cannot be undone. All data associated with this workspace will be destroyed.
                </p>
              </div>

              {isDeletedSuccess ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="my-6 flex flex-col items-center justify-center rounded-xl border border-red-500/40 bg-red-500/15 p-6 text-center"
                >
                  <CheckCircle2 className="h-8 w-8 text-red-400" />
                  <p className="mt-2 text-sm font-medium text-red-200">
                    Workspace successfully scheduled for permanent deletion.
                  </p>
                </motion.div>
              ) : (
                <div className="mt-6 space-y-4">
                  <div className="space-y-2">
                    <Label
                      htmlFor="delete-confirm-input"
                      className="text-xs font-semibold uppercase tracking-wider text-slate-400"
                    >
                      Type <span className="font-bold text-red-400">DELETE</span> to confirm
                    </Label>
                    <Input
                      id="delete-confirm-input"
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder="DELETE"
                      disabled={isDeleting}
                      autoComplete="off"
                      className="h-11 w-full border-slate-700 bg-slate-900 text-center font-mono text-base font-bold tracking-widest text-white placeholder:text-slate-600 focus-visible:border-red-500 focus-visible:ring-red-500/40"
                    />
                  </div>

                  <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCloseDeleteModal}
                      disabled={isDeleting}
                      className="h-11 flex-1 border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={deleteConfirmText !== "DELETE" || isDeleting}
                      onClick={handleConfirmDelete}
                      className="h-11 flex-1 bg-red-600 hover:bg-red-700 text-white font-bold shadow-lg shadow-red-600/30 disabled:opacity-50 disabled:bg-red-600/50 disabled:hover:bg-red-600/50 disabled:cursor-not-allowed"
                    >
                      {isDeleting ? "Deleting..." : "Delete Workspace"}
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DangerZone;
