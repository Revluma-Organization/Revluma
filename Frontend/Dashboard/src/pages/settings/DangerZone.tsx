import { useAuthStore } from "@/store/authStore";
import { TwoFactorVerifyModal } from "@/components/TwoFactorVerifyModal";
import { FC, useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRightLeft,
  AlertTriangle,
  ShieldAlert,
  Trash2,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  X,
  Lock,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

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
  // Check if user actually has 2FA enabled!
  const is2FAEnabled = useAuthStore((s) => s.user?.two_factor_enabled); 
  
  // Modal routing states
  const [is2FAOpen, setIs2FAOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"transfer" | "delete" | null>(null);
  const [isTransferConfirmOpen, setIsTransferConfirmOpen] = useState(false);

  // --- THE INTERCEPTORS ---
  
  // Intercept the Transfer Button
  const handleInitiateTransfer = (e: FormEvent) => {
    e.preventDefault();
    if (!transferEmail || !transferEmail.includes("@")) {
      setTransferFeedback({ type: "error", message: "Please enter a valid email address." });
      return;
    }
    setTransferFeedback({ type: null, message: "" });
    
    // If 2FA is on, show 2FA modal. If off, skip straight to Confirmation!
    if (is2FAEnabled) {
      setPendingAction("transfer");
      setIs2FAOpen(true);
    } else {
      setIsTransferConfirmOpen(true);
    }
  };

  // Intercept the Delete Button
  const handleInitiateDelete = () => {
    if (is2FAEnabled) {
      setPendingAction("delete");
      setIs2FAOpen(true);
    } else {
      setIsDeleteModalOpen(true);
    }
  };

  // --- THE ROUTER ---
  
  // This fires when the 2FA modal says "Success!"
  const handle2FASuccess = () => {
    setIs2FAOpen(false);
    if (pendingAction === "transfer") setIsTransferConfirmOpen(true);
    if (pendingAction === "delete") setIsDeleteModalOpen(true);
    setPendingAction(null);
  };

  // --- THE EXECUTORS (API CALLS) ---

  // Execute the Transfer
  const executeTransfer = async () => {
    setIsTransferring(true);
    try {
      await api.post("/workspace/transfer", { email: transferEmail }, { skipAuthRedirect: true });
      setIsTransferConfirmOpen(false); // Close the modal on success
      setTransferFeedback({
        type: "success",
        message: `Ownership transfer invitation sent to ${transferEmail}.`,
      });
      setTransferEmail("");
    } catch (err) {
      console.error("Failed to initiate ownership transfer:", err);
      setIsTransferConfirmOpen(false); // Close the modal on error too
      setTransferFeedback({
        type: "error",
        message: "Failed to send transfer invitation. Please try again.",
      });
    } finally {
      setIsTransferring(false);
    }
  };

  // Execute the Delete
  const handleConfirmDelete = async () => {
    if (deleteConfirmText !== "DELETE") return;
    setIsDeleting(true);
    try {
      await api.delete("/workspace", { skipAuthRedirect: true });
      setIsDeleting(false);
      setIsDeletedSuccess(true);
      setTimeout(() => {
        setIsDeleteModalOpen(false);
        setDeleteConfirmText("");
        setIsDeletedSuccess(false);
      }, 2000);
    } catch (err) {
      console.error("Failed to delete workspace:", err);
      setIsDeleting(false);
    }
  };

  const handleCloseDeleteModal = () => {
    if (isDeleting) return;
    setIsDeleteModalOpen(false);
    setDeleteConfirmText("");
  };

    return (
    <div className="w-full max-w-5xl space-y-8 bg-transparent text-slate-900 dark:text-slate-100 pb-10">
      <div className="mx-auto max-w-4xl space-y-8">
        {/* Page Header */}
        <div className="border-b border-red-200 dark:border-red-500/40 pb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-500 ring-1 ring-red-500/20 dark:ring-red-500/40">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
                Danger Zone
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
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
          className="rounded-2xl border border-red-200 dark:border-red-500/50 bg-white dark:bg-slate-900/50 p-6 shadow-sm dark:shadow-lg dark:shadow-red-950/20 transition-all duration-300 hover:border-red-300 dark:hover:border-red-500 sm:p-8"
        >
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-start">
            <div className="space-y-2 md:max-w-xl">
              <div className="flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-red-600 dark:text-red-400" />
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white sm:text-xl">
                  Transfer Ownership
                </h2>
              </div>
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Transferring workspace ownership will grant full administrative and billing rights to another user. You will lose owner-level privileges immediately once the transfer is accepted.
              </p>
            </div>

            <form
              onSubmit={handleInitiateTransfer}
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
                  className="h-10 w-full border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950/80 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus-visible:ring-red-500/50 shadow-sm"
                  disabled={isTransferring}
                />
              </div>
              <button
                type="submit"
                disabled={isTransferring}
                className="h-10 whitespace-nowrap rounded-md px-5 font-semibold shadow-sm transition-colors active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                style={{ backgroundColor: '#dc2626', color: '#ffffff', border: '1px solid #dc2626' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#b91c1c'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#dc2626'; }}
              >
                {isTransferring ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Transferring...
                  </span>
                ) : "Transfer Workspace"}
              </button>
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
                    ? "border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300"
                }`}
              >
                {transferFeedback.type === "success" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
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
          className="rounded-2xl border border-red-200 dark:border-red-500/50 bg-white dark:bg-slate-900/50 p-6 shadow-sm dark:shadow-lg dark:shadow-red-950/20 transition-all duration-300 hover:border-red-300 dark:hover:border-red-500 sm:p-8"
        >
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div className="space-y-2 md:max-w-xl">
              <div className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white sm:text-xl">
                  Delete Workspace
                </h2>
              </div>
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Once you delete a workspace, there is no going back. All customer profiles, cart recovery workflows, integrations, analytics data, and historical logs will be permanently erased immediately.
              </p>
            </div>

            <button
                type="button"
                onClick={handleInitiateDelete} 
                className="h-10 w-full whitespace-nowrap rounded-md px-6 font-semibold shadow-sm transition-colors active:scale-[0.98] sm:w-auto"
                style={{ backgroundColor: '#dc2626', color: '#ffffff', border: '1px solid #dc2626' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#b91c1c'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#dc2626'; }}
              >
                Delete Workspace
              </button>
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
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 dark:bg-black/80 p-4 backdrop-blur-sm"
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
              className="relative w-full max-w-md overflow-hidden rounded-3xl border border-red-200 dark:border-red-500/60 bg-white dark:bg-slate-950 p-6 text-slate-900 dark:text-slate-100 shadow-2xl sm:p-8"
            >
              {/* Close Icon Button */}
              <button
                type="button"
                onClick={handleCloseDeleteModal}
                disabled={isDeleting}
                className="absolute right-4 top-4 rounded-full p-2 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white disabled:opacity-50"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-500 ring-1 ring-red-500/20 dark:ring-red-500/40">
                  <AlertTriangle className="h-7 w-7" />
                </div>
                <h3 className="mt-5 text-xl font-bold text-slate-900 dark:text-white">
                  Permanently Delete Workspace?
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                  This action is permanent and cannot be undone. All data associated with this workspace will be destroyed.
                </p>
              </div>

              {isDeletedSuccess ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="my-6 flex flex-col items-center justify-center rounded-xl border border-red-200 dark:border-red-500/40 bg-red-50 dark:bg-red-500/15 p-6 text-center"
                >
                  <CheckCircle2 className="h-8 w-8 text-red-500 dark:text-red-400" />
                  <p className="mt-2 text-sm font-medium text-red-700 dark:text-red-200">
                    Workspace successfully scheduled for permanent deletion.
                  </p>
                </motion.div>
              ) : (
                <div className="mt-6 space-y-4">
                  <div className="space-y-2">
                    <Label
                      htmlFor="delete-confirm-input"
                      className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                    >
                      Type <span className="font-bold text-red-600 dark:text-red-400">DELETE</span> to confirm
                    </Label>
                    <Input
                      id="delete-confirm-input"
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder="DELETE"
                      disabled={isDeleting}
                      autoComplete="off"
                      className="h-12 w-full border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-center font-mono text-lg font-bold tracking-widest text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus-visible:border-red-500 focus-visible:ring-red-500/40 shadow-sm"
                    />
                  </div>

                  <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCloseDeleteModal}
                      disabled={isDeleting}
                      className="h-11 flex-1 border-slate-300 dark:border-slate-700 bg-white dark:bg-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:hover:text-white shadow-sm"
                    >
                      Cancel
                    </Button>
                    <button
                      type="button"
                      disabled={deleteConfirmText !== "DELETE" || isDeleting}
                      onClick={handleConfirmDelete}
                      className="h-11 flex-1 rounded-md font-bold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      style={{
                        backgroundColor: deleteConfirmText !== "DELETE" || isDeleting ? 'rgba(220,38,38,0.5)' : '#dc2626',
                        color: '#ffffff',
                        border: '1px solid #dc2626',
                      }}
                      onMouseEnter={(e) => {
                        if (deleteConfirmText === "DELETE" && !isDeleting) {
                          (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#b91c1c';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (deleteConfirmText === "DELETE" && !isDeleting) {
                          (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#dc2626';
                        } else {
                          (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(220,38,38,0.5)';
                        }
                      }}
                    >
                      {isDeleting ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Deleting...
                        </span>
                      ) : (
                        "Delete Workspace"
                      )}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <TwoFactorVerifyModal
          isOpen={is2FAOpen}
          onClose={() => setIs2FAOpen(false)}
          onSuccess={handle2FASuccess}
        />
    </div>
  );
};

export default DangerZone;
