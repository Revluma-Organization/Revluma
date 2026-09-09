import { FC, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Download,
  CheckCircle2,
  Clock,
  Loader2,
  X,
  Search,
  Filter,
  FileSpreadsheet,
  ArrowDown,
  ArrowUp,
  CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  date: string;
  amount: string;
  plan: "Growth" | "Scale";
  status: "Paid" | "Pending" | "Refunded";
  cardLast4: string;
  cardBrand?: string; // Added to dynamically handle Visa, Mastercard, Verve, etc.
}

// ⚠️ TEMPORARY MOCK DATA: Just so i see the UI! 
const mockInvoices: InvoiceRecord[] = [
  { id: "1", invoiceNumber: "INV-2026-081", date: "12.01.2024", amount: "+ 182.99 $", plan: "Scale", status: "Paid", cardLast4: "9918", cardBrand: "mastercard" },
  { id: "2", invoiceNumber: "INV-2026-080", date: "12.01.2024", amount: "- 12.49 $", plan: "Growth", status: "Pending", cardLast4: "4242", cardBrand: "visa" },
  { id: "3", invoiceNumber: "INV-2026-079", date: "12.01.2024", amount: "- 3.03 $", plan: "Growth", status: "Refunded", cardLast4: "1111", cardBrand: "verve" },
  { id: "4", invoiceNumber: "INV-2026-078", date: "12.01.2024", amount: "+ 72.99 $", plan: "Scale", status: "Paid", cardLast4: "9918", cardBrand: "mastercard" },
];

export const InvoiceHistory: FC = () => {
  // ⚠️ When backend is ready, change this line to: const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>(mockInvoices);
  
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // REAL API FETCH IS RESTORED HERE
  const fetchInvoices = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get<InvoiceRecord[]>("/billing/invoices", undefined, { skipAuthRedirect: true });
      // If the backend returns data, it will overwrite the mock data automatically
      if (res && Array.isArray(res.data)) {
        setInvoices(res.data);
      }
    } catch (err) {
      console.warn("Failed to fetch invoices from API:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const handleDownloadPdf = async (invoice: InvoiceRecord) => {
    setDownloadingId(invoice.id);
    setFeedbackMessage(null);
    try {
      const res = await api.get<{ downloadUrl: string }>(
        `/billing/invoices/${invoice.id}/download`,
        undefined,
        { skipAuthRedirect: true }
      );
      if (res?.data?.downloadUrl) {
        window.open(res.data.downloadUrl, "_blank", "noopener,noreferrer");
      }
      setFeedbackMessage(
        `PDF receipt for ${invoice.invoiceNumber} is ready.`
      );
    } catch (err) {
      console.error("Failed to get invoice download URL:", err);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleExportCsv = async () => {
    setIsExporting(true);
    setFeedbackMessage(null);
    try {
      const res = await api.get<{ downloadUrl: string }>(
        "/billing/invoices/export",
        undefined,
        { skipAuthRedirect: true }
      );
      if (res?.data?.downloadUrl) {
        window.open(res.data.downloadUrl, "_blank", "noopener,noreferrer");
      }
      setFeedbackMessage(
        `Exported ${invoices.length} billing records successfully.`
      );
    } catch (err) {
      console.error("Failed to export invoices CSV:", err);
    } finally {
      setIsExporting(false);
    }
  };

  const filteredInvoices = invoices.filter((inv) => {
    const matchesSearch =
      inv.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.date.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.plan.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      statusFilter === "all" ||
      inv.status.toLowerCase() === statusFilter.toLowerCase();

    return matchesSearch && matchesStatus;
  });

  const getStatusDetails = (status: InvoiceRecord["status"]) => {
    switch (status) {
      case "Paid":
        return {
          icon: <ArrowDown className="h-5 w-5 text-emerald-500" />,
          bg: "bg-emerald-50 dark:bg-emerald-500/10",
          amountColor: "text-emerald-500",
        };
      case "Refunded":
        return {
          icon: <X className="h-5 w-5 text-rose-500" />,
          bg: "bg-rose-50 dark:bg-rose-500/10",
          amountColor: "text-slate-900 dark:text-white",
        };
      case "Pending":
      default:
        return {
          icon: <ArrowUp className="h-5 w-5 text-slate-400" />,
          bg: "bg-slate-50 dark:bg-slate-800",
          amountColor: "text-slate-900 dark:text-white",
        };
    }
  };

  // Helper function to format the card brand text nicely
  const getCardBrandDisplay = (brand?: string) => {
    if (!brand) return "Card";
    const lower = brand.toLowerCase();
    if (lower.includes("mastercard")) return "Mastercard";
    if (lower.includes("visa")) return "Visa";
    if (lower.includes("verve")) return "Verve";
    // Capitalize the first letter for unknown brands
    return brand.charAt(0).toUpperCase() + brand.slice(1);
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6 bg-transparent text-slate-900 dark:text-slate-100 pb-10">
      
      {/* Header & Controls */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Invoice History
        </h1>
        <Button
          type="button"
          variant="outline"
          onClick={handleExportCsv}
          disabled={isExporting}
          className="h-10 rounded-full border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50"
        >
          {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin text-sky-500" /> : <FileSpreadsheet className="mr-2 h-4 w-4 text-sky-500" />}
          <span>Export</span>
        </Button>
      </div>

      {/* Filters (All, Paid, Pending) */}
      <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar">
        {(["all", "Paid", "Pending"] as const).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(status)}
            className={`rounded-full px-5 py-2 text-sm font-semibold capitalize transition-all shrink-0 ${
              statusFilter === status
                ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900"
                : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800"
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {/* The List Layout strictly matching the Inspo */}
      <div className="space-y-3 mt-4">
        <AnimatePresence initial={false}>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500">
              <Loader2 className="h-8 w-8 animate-spin text-sky-500 mb-3" />
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 rounded-[28px] border border-dashed border-slate-200 bg-white/50">
              <FileText className="h-10 w-10 text-slate-300 mb-3" />
              <span className="text-sm font-medium">No invoices found.</span>
            </div>
          ) : (
            filteredInvoices.map((inv) => {
              const isDownloading = downloadingId === inv.id;
              const { icon, bg, amountColor } = getStatusDetails(inv.status);

              return (
                <motion.div
                  key={inv.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="flex items-center justify-between p-4 sm:p-5 rounded-[28px] bg-white dark:bg-slate-900 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-slate-100 dark:border-slate-800"
                >
                  {/* Left Side: Icon & Titles */}
                  <div className="flex items-center gap-4">
                    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${bg}`}>
                      {icon}
                    </div>
                    
                    <div>
                      <h4 className="font-semibold text-slate-900 dark:text-white text-[15px]">
                        {inv.invoiceNumber}
                      </h4>
                      <div className="flex items-center gap-1.5 mt-1 text-[13px] text-slate-400 font-medium">
                        {/* Dynamic Card Icon and Text */}
                        <CreditCard className="h-3.5 w-3.5 text-slate-300 dark:text-slate-500" />
                        <span>{getCardBrandDisplay(inv.cardBrand)} **** {inv.cardLast4}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Side: Amount, Date & Subtle Download */}
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <p className={`font-bold text-[15px] ${amountColor}`}>
                        {inv.amount}
                      </p>
                      <p className="text-[13px] font-medium text-slate-400 mt-1">
                        {inv.date}
                      </p>
                    </div>

                    {/* Minimalist Download Icon */}
                    <button
                      type="button"
                      disabled={isDownloading}
                      onClick={() => handleDownloadPdf(inv)}
                      className="ml-2 h-9 w-9 flex items-center justify-center rounded-full bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-sky-500 hover:bg-sky-50 transition-colors disabled:opacity-50"
                    >
                      {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    </button>
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default InvoiceHistory;
