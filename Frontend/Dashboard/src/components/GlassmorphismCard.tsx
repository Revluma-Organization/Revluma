import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertCircle } from "lucide-react";

interface GlassmorphismCardProps {
    isOpen: boolean;
    type: "success" | "error";
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
    buttonText = type === "success" ? "Continue to Login" : "Try Again",
    onClose,
    autoClose = type === "success",
    autoCloseDelay = 3000,
}: GlassmorphismCardProps) {
    useEffect(() => {
        if (isOpen && autoClose) {
            const timer = setTimeout(() => {
                onClose?.();
            }, autoCloseDelay);
            return () => clearTimeout(timer);
        }
    }, [isOpen, autoClose, autoCloseDelay, onClose]);

    const isSuccess = type === "success";
    const bgGradient = isSuccess
        ? "from-green-500/10 to-emerald-500/10"
        : "from-red-500/10 to-orange-500/10";
    const borderColor = isSuccess ? "border-green-500/30" : "border-red-500/30";
    const iconColor = isSuccess ? "text-green-400" : "text-red-400";
    const buttonGradient = isSuccess
        ? "from-green-500/40 to-emerald-500/30 hover:from-green-500/50 hover:to-emerald-500/40"
        : "from-red-500/40 to-orange-500/30 hover:from-red-500/50 hover:to-orange-500/40";

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/60"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ scale: 0.95, y: 20, opacity: 0 }}
                        animate={{ scale: 1, y: 0, opacity: 1 }}
                        exit={{ scale: 0.95, y: 20, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        className={`relative max-w-md w-full mx-4 rounded-2xl border ${borderColor} bg-gradient-to-br ${bgGradient} backdrop-blur-3xl shadow-2xl overflow-hidden`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Glassmorphism effect overlay */}
                        <div className="absolute inset-0 bg-white/[0.08] pointer-events-none" />

                        {/* Decorative elements */}
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-gradient-to-b from-white/20 to-transparent rounded-full blur-3xl" />

                        {/* Content */}
                        <div className="relative p-8 text-center">
                            {/* Icon */}
                            <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{
                                    delay: 0.2,
                                    type: "spring",
                                    stiffness: 300,
                                    damping: 25,
                                }}
                                className={`mx-auto mb-6 w-16 h-16 rounded-full flex items-center justify-center ${isSuccess ? "bg-green-500/20" : "bg-red-500/20"}`}
                            >
                                {isSuccess ? (
                                    <CheckCircle2 className={`w-8 h-8 ${iconColor}`} />
                                ) : (
                                    <AlertCircle className={`w-8 h-8 ${iconColor}`} />
                                )}
                            </motion.div>

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
                                className="text-gray-300 text-base leading-relaxed mb-6"
                            >
                                {message}
                            </motion.p>

                            {/* Button */}
                            <motion.button
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.5 }}
                                onClick={onClose}
                                className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm bg-gradient-to-r ${buttonGradient} ${isSuccess ? "text-green-300" : "text-red-300"} border ${isSuccess ? "border-green-500/50" : "border-red-500/50"} transition-all duration-300 hover:shadow-lg hover:shadow-${isSuccess ? "green" : "red"}-500/20 hover:-translate-y-0.5`}
                            >
                                {buttonText}
                            </motion.button>

                            {/* Auto-close indicator */}
                            {autoClose && (
                                <motion.div
                                    initial={{ scaleX: 1 }}
                                    animate={{ scaleX: 0 }}
                                    transition={{ duration: autoCloseDelay / 1000, ease: "linear" }}
                                    className={`absolute bottom-0 left-0 h-1 bg-gradient-to-r ${isSuccess ? "from-green-500 to-emerald-500" : "from-red-500 to-orange-500"} origin-left`}
                                />
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
