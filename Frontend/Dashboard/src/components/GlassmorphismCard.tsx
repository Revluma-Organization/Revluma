import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertCircle } from "lucide-react";

interface GlassmorphismCardProps {
    isOpen: boolean;
    type: "success" | "error" | "loading";
    title: string;
    message: string;
    buttonText?: string;
    onClose?: () => void;
    autoClose?: boolean;
    autoCloseDelay?: number;
}

export default function GlassmorphismCard({
    isOpen,
    type,
    title,
    message,
    buttonText = type === "success" ? "Continue" : "Try Again",
    onClose,
    autoClose = type === "success",
    autoCloseDelay = 3000,
}: GlassmorphismCardProps) {
    useEffect(() => {
        if (isOpen && autoClose && type !== "loading") {
            const timer = setTimeout(() => {
                onClose?.();
            }, autoCloseDelay);
            return () => clearTimeout(timer);
        }
    }, [isOpen, autoClose, autoCloseDelay, onClose, type]);

    const isSuccess = type === "success";
    const isLoading = type === "loading";

    // Strictly monochrome — success and error are told apart by icon shape
    // (check vs. exclamation) and fill weight, never by hue. Loading gets
    // its own neutral treatment with a spinner instead of an icon/button.
    const borderColor = isLoading
        ? "border-white/15"
        : isSuccess
            ? "border-white/25"
            : "border-white/10";
    const cardBg = isLoading
        ? "bg-white/[0.06]"
        : isSuccess
            ? "bg-white/[0.1]"
            : "bg-black/40";

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/70"
                    onClick={isLoading ? undefined : onClose}
                >
                    <motion.div
                        initial={{ scale: 0.95, y: 20, opacity: 0 }}
                        animate={{ scale: 1, y: 0, opacity: 1 }}
                        exit={{ scale: 0.95, y: 20, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        className={`relative max-w-md w-full mx-4 rounded-2xl border ${borderColor} ${cardBg} backdrop-blur-3xl shadow-2xl overflow-hidden`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Glassmorphism effect overlay */}
                        <div className="absolute inset-0 bg-white/[0.06] pointer-events-none" />

                        {/* Decorative elements */}
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-gradient-to-b from-white/20 to-transparent rounded-full blur-3xl" />

                        {/* Content */}
                        <div className="relative p-8 text-center">
                            {isLoading ? (
                                // Big, unmistakable spinner — no icon, no button, so it
                                // reads unambiguously as "something is happening" rather
                                // than a dismissible message.
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 25 }}
                                    className="mx-auto mb-6 h-14 w-14 rounded-full border-[3px] border-white/15 border-t-white animate-spin"
                                    aria-hidden="true"
                                />
                            ) : (
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{
                                        delay: 0.2,
                                        type: "spring",
                                        stiffness: 300,
                                        damping: 25,
                                    }}
                                    className={`mx-auto mb-6 w-16 h-16 rounded-full flex items-center justify-center ${isSuccess ? "bg-white text-black" : "bg-white/10 border border-white/30 text-white"
                                        }`}
                                >
                                    {isSuccess ? (
                                        <CheckCircle2 className="w-8 h-8" />
                                    ) : (
                                        <AlertCircle className="w-8 h-8" />
                                    )}
                                </motion.div>
                            )}

                            {/* Title */}
                            <motion.h2
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.3 }}
                                className="text-2xl font-bold text-white mb-2 tracking-tight"
                            >
                                {title}
                            </motion.h2>

                            {/* Message */}
                            <motion.p
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.4 }}
                                className="text-white/60 text-base leading-relaxed mb-6"
                            >
                                {message}
                            </motion.p>

                            {/* Button — hidden entirely for the loading state */}
                            {!isLoading && (
                                <motion.button
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.5 }}
                                    onClick={onClose}
                                    className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm transition-all duration-300 hover:-translate-y-0.5 ${isSuccess
                                            ? "bg-white text-black hover:bg-white/90"
                                            : "bg-white/10 text-white border border-white/25 hover:bg-white/18"
                                        }`}
                                >
                                    {buttonText}
                                </motion.button>
                            )}

                            {/* Auto-close indicator — success only */}
                            {!isLoading && autoClose && (
                                <motion.div
                                    initial={{ scaleX: 1 }}
                                    animate={{ scaleX: 0 }}
                                    transition={{ duration: autoCloseDelay / 1000, ease: "linear" }}
                                    className="absolute bottom-0 left-0 h-1 bg-white/50 origin-left"
                                />
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}