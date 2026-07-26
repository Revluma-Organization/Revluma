import { FC, useState } from "react";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  Crown,
  Shield,
  User,
  Eye,
  CheckCircle2,
  Minus,
  Info,
  KeyRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface RoleTier {
  id: "owner" | "admin" | "member" | "viewer";
  name: string;
  description: string;
  badgeText: string;
  badgeStyle: string;
  icon: JSX.Element;
}

interface PermissionRow {
  category: string;
  feature: string;
  description: string;
  owner: boolean;
  admin: boolean;
  member: boolean;
  viewer: boolean;
}

const ROLE_TIERS: RoleTier[] = [
  {
    id: "owner",
    name: "Owner",
    description:
      "Full administrative control, workspace ownership transfers, and permanent deletion.",
    badgeText: "Workspace Owner",
    badgeStyle:
      "border-amber-500/30 bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/20",
    icon: <Crown className="h-5 w-5 text-amber-400" />,
  },
  {
    id: "admin",
    name: "Admin",
    description:
      "Manage workspace settings, invite and remove staff, and configure integrations.",
    badgeText: "Full Access",
    badgeStyle:
      "border-sky-500/30 bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/20",
    icon: <Shield className="h-5 w-5 text-sky-400" />,
  },
  {
    id: "member",
    name: "Member",
    description:
      "Create and edit product catalog items, manage customer workflows, and view reports.",
    badgeText: "Standard Access",
    badgeStyle:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20",
    icon: <User className="h-5 w-5 text-emerald-400" />,
  },
  {
    id: "viewer",
    name: "Viewer",
    description:
      "Read-only access to analytics dashboards, financial reports, and catalog listings.",
    badgeText: "Read Only",
    badgeStyle:
      "border-slate-700 bg-slate-800/80 text-slate-300 ring-1 ring-slate-700",
    icon: <Eye className="h-5 w-5 text-slate-400" />,
  },
];

const PERMISSIONS_MATRIX: PermissionRow[] = [
  // Workspace & Governance
  {
    category: "Workspace & Governance",
    feature: "Danger Zone (Delete workspace, transfer ownership)",
    description: "Execute irreversible workspace deletions or transfer legal ownership",
    owner: true,
    admin: false,
    member: false,
    viewer: false,
  },
  {
    category: "Workspace & Governance",
    feature: "Billing & Subscriptions",
    description: "Manage credit card payment methods, view invoices, and upgrade plans",
    owner: true,
    admin: true,
    member: false,
    viewer: false,
  },
  {
    category: "Workspace & Governance",
    feature: "Team Management",
    description: "Invite staff members, promote admins, and remove existing members",
    owner: true,
    admin: true,
    member: false,
    viewer: false,
  },
  // Product Catalog & Operations
  {
    category: "Product Catalog & Operations",
    feature: "Product Catalog Management",
    description: "Create new items, update inventory levels, and archive products",
    owner: true,
    admin: true,
    member: true,
    viewer: false,
  },
  {
    category: "Product Catalog & Operations",
    feature: "Cart Recovery Workflows",
    description: "Configure automated email recovery rules and abandon sequences",
    owner: true,
    admin: true,
    member: true,
    viewer: false,
  },
  {
    category: "Product Catalog & Operations",
    feature: "Customer Profiles & Orders",
    description: "Access customer order history, issue refunds, and update notes",
    owner: true,
    admin: true,
    member: true,
    viewer: false,
  },
  // Developer & Analytics
  {
    category: "Developer & Analytics",
    feature: "API Keys & Webhooks",
    description: "Generate production API keys and configure webhook notification URLs",
    owner: true,
    admin: true,
    member: false,
    viewer: false,
  },
  {
    category: "Developer & Analytics",
    feature: "Analytics & Financial Reports",
    description: "View real-time revenue charts, conversion metrics, and export CSVs",
    owner: true,
    admin: true,
    member: true,
    viewer: true,
  },
  {
    category: "Developer & Analytics",
    feature: "Audit Log Inspection",
    description: "View system audit trails, authentication logs, and member activity",
    owner: true,
    admin: true,
    member: false,
    viewer: false,
  },
];

export const RolesPermissions: FC = () => {
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  const categories = [
    "All",
    "Workspace & Governance",
    "Product Catalog & Operations",
    "Developer & Analytics",
  ];

  const filteredMatrix =
    selectedCategory === "All"
      ? PERMISSIONS_MATRIX
      : PERMISSIONS_MATRIX.filter((row) => row.category === selectedCategory);

  return (
    <div className="w-full max-w-6xl space-y-10 text-slate-100">
      {/* Page Header */}
      <div className="border-b border-slate-800 pb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20">
            <KeyRound className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Roles & Permissions
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Review workspace role tiers and inspect detailed access privileges across features.
            </p>
          </div>
        </div>
      </div>

      {/* Role Tiers Grid */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white sm:text-xl">
            Workspace Role Tiers
          </h2>
          <span className="text-xs text-slate-500">
            4 predefined access levels
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ROLE_TIERS.map((tier, index) => (
            <motion.div
              key={tier.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-lg transition-all duration-300 hover:border-slate-700"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 border border-slate-800">
                    {tier.icon}
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[0.68rem] font-semibold px-2.5 py-0.5 rounded-full ${tier.badgeStyle}`}
                  >
                    {tier.badgeText}
                  </Badge>
                </div>

                <div>
                  <h3 className="text-base font-bold text-white">
                    {tier.name}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    {tier.description}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Permissions Matrix Table Section */}
      <section className="space-y-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-semibold text-white sm:text-xl">
              Permissions Matrix
            </h2>
            <p className="text-xs text-slate-400 sm:text-sm">
              Granular access breakdown for each role across core platform capabilities.
            </p>
          </div>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {categories.map((category) => {
              const isActive = selectedCategory === category;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setSelectedCategory(category)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    isActive
                      ? "bg-sky-600 text-white shadow-md shadow-sky-600/20"
                      : "border border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  {category}
                </button>
              );
            })}
          </div>
        </div>

        {/* Matrix Card Wrapper */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 shadow-2xl"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/70 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-6 py-4 min-w-[280px]">Feature & Access</th>
                  <th className="px-5 py-4 text-center min-w-[100px]">Owner</th>
                  <th className="px-5 py-4 text-center min-w-[100px]">Admin</th>
                  <th className="px-5 py-4 text-center min-w-[100px]">Member</th>
                  <th className="px-5 py-4 text-center min-w-[100px]">Viewer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredMatrix.map((row) => (
                  <tr
                    key={row.feature}
                    className="group transition-colors hover:bg-slate-800/30"
                  >
                    {/* Feature Description */}
                    <td className="px-6 py-4">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 font-medium text-white">
                          <span>{row.feature}</span>
                          <span className="hidden text-[0.68rem] text-slate-500 group-hover:inline-block">
                            ({row.category})
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">
                          {row.description}
                        </p>
                      </div>
                    </td>

                    {/* Owner Access */}
                    <td className="px-5 py-4 text-center">
                      <div className="flex justify-center">
                        {row.owner ? (
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30">
                            <CheckCircle2 className="h-4 w-4" />
                          </div>
                        ) : (
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800/50 text-slate-600">
                            <Minus className="h-3.5 w-3.5" />
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Admin Access */}
                    <td className="px-5 py-4 text-center">
                      <div className="flex justify-center">
                        {row.admin ? (
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30">
                            <CheckCircle2 className="h-4 w-4" />
                          </div>
                        ) : (
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800/50 text-slate-600">
                            <Minus className="h-3.5 w-3.5" />
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Member Access */}
                    <td className="px-5 py-4 text-center">
                      <div className="flex justify-center">
                        {row.member ? (
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30">
                            <CheckCircle2 className="h-4 w-4" />
                          </div>
                        ) : (
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800/50 text-slate-600">
                            <Minus className="h-3.5 w-3.5" />
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Viewer Access */}
                    <td className="px-5 py-4 text-center">
                      <div className="flex justify-center">
                        {row.viewer ? (
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30">
                            <CheckCircle2 className="h-4 w-4" />
                          </div>
                        ) : (
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800/50 text-slate-600">
                            <Minus className="h-3.5 w-3.5" />
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Matrix Footer Note */}
          <div className="flex items-center gap-2 border-t border-slate-800/80 bg-slate-950/40 px-6 py-3 text-xs text-slate-400">
            <Info className="h-3.5 w-3.5 text-slate-500 shrink-0" />
            <span>
              Role privileges are enforced across both dashboard UI views and underlying REST API endpoints.
            </span>
          </div>
        </motion.div>
      </section>
    </div>
  );
};

export default RolesPermissions;
