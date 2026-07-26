import { FC, useState } from "react";
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
  ArrowDownToLine,
  FileSpreadsheet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  date: string;
  amount: string;
  plan: "Growth" | "Scale";
  status: "Paid" | "Pending" | "Refunded";
  cardLast4: string;
}

const INITIAL_INVOICES: InvoiceRecord[] = [
  {
    id: "inv-4",
    invoiceNumber: "INV-2026-004",
    date: "Jul 26, 2026",
    amount: "$50.00",
    plan: "Scale",
    status: "Paid",
    cardLast4: "4242",
  },
  {
    id: "inv-3",
    invoiceNumber: "INV-2026-003",
    date: "Jun 26, 2026",
    amount: "$50.00",
    plan: "Scale",
    status: "Paid",
    cardLast4: "4242",
  },
  {
    id: "inv-2",
    invoiceNumber: "INV-2026-002",
    date: "May 26, 2026",
    amount: "$29.00",
    plan: "Growth",
    status: "Paid",
    cardLast4: "8899",
  },
  {
    id: "inv-1",
    invoiceNumber: "INV-2026-001",
    date: "Apr 26, 2026",
    amount: "$29.00",
    plan: "Growth",
    status: "Pending",
    cardLast4: "8899",
  },
];

export const InvoiceHistory: FC = () => {
  const [invoices] = useState<InvoiceRecord[]>(INITIAL_INVOICES);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const handleDownloadPdf = (invoice: InvoiceRecord) => {
    setDownloadingId(invoice.id);
    setFeedbackMessage(null);

    setTimeout(() => {
      setDownloadingId(null);
      setFeedbackMessage(
        `Downloaded PDF receipt for ${invoice.invoiceNumber} (${invoice.amount}).`
      );
    }, 1000);
  };

  const handleExportCsv = () => {
    setFeedbackMessage(
      `Exported ${filteredInvoices.length} billing records to "revluma_invoices_export.csv".`
    );
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

  const getStatusBadge = (status: InvoiceRecord["status"]) => {
    switch (status) {
      case "Paid":
        return (
          <Badge
            variant="outline"
            className="inline-flex items-center gap-1.5 rounded-full border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-300"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>Paid</span>
          </Badge>
        );
      case "Pending":
        return (
          <Badge
            variant="outline"
            className="inline-flex items-center gap-1.5 rounded-full border-slate-600 bg-slate-800/80 px-2.5 py-0.5 text-xs font-semibold text-slate-300"
          >
            <Clock className="h-3 w-3 text-slate-400" />
            <span>Pending</span>
          </Badge>
        );
      default:
        return (
          <Badge
            variant="outline"
            className="rounded-full border-slate-700 bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-400"
          >
            {status}
          </Badge>
        );
    }
  };

  const getPlanBadge = (plan: InvoiceRecord["plan"]) => {
    return (
      <span className="inline-flex items-center rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-medium text-slate-200">
        {plan}
      </span>
    );
  };

  return (
    <div className="w-full max-w-5xl space-y-8 rounded-2xl bg-slate-950 p-6 text-slate-100 shadow-2xl sm:p-8 md:p-10">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Invoice History
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Review and download tax-ready PDF receipts for past Paystack billing cycles.
            </p>
          </div>
        </div>

        {/* Global Action Button */}
        <Button
          type="button"
          variant="outline"
          onClick={handleExportCsv}
          className="h-11 border-slate-700 bg-slate-900/80 px-5 font-semibold text-slate-200 hover:bg-slate-800 hover:text-white"
        >
          <FileSpreadsheet className="mr-2 h-4 w-4 text-sky-400" />
          <span>Export All (CSV)</span>
        </Button>
      </div>

      {/* Inline Feedback Toast */}
      <AnimatePresence>
        {feedbackMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>{feedbackMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="rounded p-1 text-slate-400 hover:text-white"
              aria-label="Dismiss message"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search and Filters Bar */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search invoice number, date, or plan..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-10 w-full rounded-xl border border-slate-800 bg-slate-900/80 pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 sm:text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-500" />
          <span className="text-xs text-slate-400">Status:</span>
          {(["all", "Paid", "Pending"] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-all ${
                statusFilter === status
                  ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                  : "bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-white border border-slate-800"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Minimalist Data Table (bg-slate-900/50 with border-slate-800) */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50 shadow-2xl backdrop-blur-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800/80 bg-slate-950/70 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <th scope="col" className="px-6 py-4">
                  Invoice
                </th>
                <th scope="col" className="px-6 py-4">
                  Date
                </th>
                <th scope="col" className="px-6 py-4">
                  Amount
                </th>
                <th scope="col" className="px-6 py-4">
                  Plan
                </th>
                <th scope="col" className="px-6 py-4">
                  Status
                </th>
                <th scope="col" className="px-6 py-4 text-right">
                  Action
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60">
              <AnimatePresence initial={false}>
                {filteredInvoices.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-12 text-center text-sm text-slate-500"
                    >
                      No matching invoices found.
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((inv) => {
                    const isDownloading = downloadingId === inv.id;

                    return (
                      <motion.tr
                        key={inv.id}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="transition-colors hover:bg-slate-800/40"
                      >
                        {/* Invoice Number */}
                        <td className="whitespace-nowrap px-6 py-4 font-mono font-semibold text-white">
                          {inv.invoiceNumber}
                        </td>

                        {/* Date */}
                        <td className="whitespace-nowrap px-6 py-4 text-slate-300">
                          {inv.date}
                        </td>

                        {/* Amount */}
                        <td className="whitespace-nowrap px-6 py-4 font-bold text-white">
                          {inv.amount}
                        </td>

                        {/* Plan */}
                        <td className="whitespace-nowrap px-6 py-4">
                          {getPlanBadge(inv.plan)}
                        </td>

                        {/* Status Pill Badge */}
                        <td className="whitespace-nowrap px-6 py-4">
                          {getStatusBadge(inv.status)}
                        </td>

                        {/* Action: Trailing column with Download PDF button */}
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isDownloading}
                            onClick={() => handleDownloadPdf(inv)}
                            className="border-slate-700 bg-slate-950/80 text-xs font-semibold text-slate-300 hover:border-sky-500/40 hover:bg-sky-500/10 hover:text-sky-300"
                          >
                            {isDownloading ? (
                              <>
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-sky-400" />
                                <span>Generating PDF...</span>
                              </>
                            ) : (
                              <>
                                <Download className="mr-1.5 h-3.5 w-3.5 text-sky-400" />
                                <span>Download PDF</span>
                              </>
                            )}
                          </Button>
                        </td>
                      </motion.tr>
                    );
                  })
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        <div className="flex items-center justify-between border-t border-slate-800/80 bg-slate-950/40 px-6 py-3.5 text-xs text-slate-400">
          <span>
            Showing {filteredInvoices.length} of {invoices.length} billing records
          </span>
          <span className="hidden sm:inline">
            Taxes included where applicable • Powered by Paystack
          </span>
        </div>
      </div>
    </div>
  );
};

export default InvoiceHistory;
