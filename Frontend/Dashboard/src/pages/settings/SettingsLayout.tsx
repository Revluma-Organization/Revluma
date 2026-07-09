import { FC } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

// Groupings based on the user document + image layout logic
const SIDEBAR_SECTIONS = [
  {
    title: "Account",
    links: [
      { path: "/dashboard/settings/profile", label: "Profile" },
      { path: "/dashboard/settings/preferences", label: "Preferences" },
      { path: "/dashboard/settings/notifications", label: "Notifications" },
      { path: "/dashboard/settings/active-sessions", label: "Active Sessions" },
    ]
  },
  {
    title: "Workspace",
    links: [
      { path: "/dashboard/settings/organization", label: "Organization" },
      { path: "/dashboard/settings/team", label: "Team Members" },
      { path: "/dashboard/settings/roles", label: "Roles & Permissions" },
      { path: "/dashboard/settings/branding", label: "Branding" },
    ]
  },
  {
    title: "Billing",
    links: [
      { path: "/dashboard/settings/billing", label: "Overview" },
      { path: "/dashboard/settings/subscription", label: "Subscription" },
      { path: "/dashboard/settings/payment-methods", label: "Payment Methods" },
      { path: "/dashboard/settings/invoices", label: "Invoice History" },
    ]
  },
  {
    title: "Intelligence & Automation",
    links: [
      { path: "/dashboard/settings/ai", label: "AI Settings" },
      { path: "/dashboard/settings/automation", label: "Automation" },
      { path: "/dashboard/settings/customer-data", label: "Customer Data" },
      { path: "/dashboard/settings/analytics", label: "Analytics" },
    ]
  },
  {
    title: "Communication",
    links: [
      { path: "/dashboard/settings/communication", label: "Channels" },
      { path: "/dashboard/settings/email", label: "Email" },
      { path: "/dashboard/settings/sms", label: "SMS" },
      { path: "/dashboard/settings/whatsapp", label: "WhatsApp" },
    ]
  },
  {
    title: "Developers",
    links: [
      { path: "/dashboard/settings/api-keys", label: "API Keys" },
      { path: "/dashboard/settings/webhooks", label: "Webhooks" },
      { path: "/dashboard/settings/feature-flags", label: "Feature Flags" },
    ]
  },
  {
    title: "Security & System",
    links: [
      { path: "/dashboard/settings/security", label: "Security" },
      { path: "/dashboard/settings/privacy", label: "Privacy" },
      { path: "/dashboard/settings/compliance", label: "Compliance" },
      { path: "/dashboard/settings/domains", label: "Domains" },
      { path: "/dashboard/settings/backups", label: "Backups" },
      { path: "/dashboard/settings/audit-log", label: "Audit Log" },
      { path: "/dashboard/settings/data-export", label: "Data Export" },
      { path: "/dashboard/settings/danger-zone", label: "Danger Zone" },
    ]
  }
];

const SettingsLayout: FC = () => {
  const location = useLocation();

  return (
    <div className="flex flex-col md:flex-row gap-8 w-full max-w-[1400px] mx-auto min-h-[80vh]">
      
      {/* Sidebar - Scrollable independently on desktop */}
      <aside className="w-full md:w-64 lg:w-72 flex-shrink-0">
        <div className="sticky top-6 flex flex-col gap-6 md:h-[calc(100vh-120px)] md:overflow-y-auto pr-2 pb-10 scrollbar-hide">
          {SIDEBAR_SECTIONS.map((section, idx) => (
            <div key={idx} className="flex flex-col gap-1">
              <h4 className="text-[0.65rem] font-bold text-t4 uppercase tracking-[0.11em] mb-2 px-3">
                {section.title}
              </h4>
              <nav className="flex flex-col gap-1">
                {section.links.map((link) => {
                  const isActive = location.pathname.startsWith(link.path);
                  return (
                    <NavLink
                      key={link.path}
                      to={link.path}
                      className={cn(
                        "relative px-3 py-2 text-[0.82rem] font-medium rounded-md transition-colors flex items-center justify-between border",
                        isActive
                          ? "text-t1 bg-[hsl(var(--accent)/0.1)] border-[hsl(var(--accent)/0.2)]"
                          : "text-t2 border-transparent hover:text-t1 hover:bg-white/[0.065]"
                      )}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="settings-active-pill"
                          className="absolute inset-0 bg-[hsl(var(--accent)/0.05)] rounded-md -z-10"
                          initial={false}
                          transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        />
                      )}
                      <span className="relative z-10 font-semibold">{link.label}</span>
                      {isActive && (
                        <span className="absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-r bg-[hsl(var(--accent))]" />
                      )}
                    </NavLink>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 w-full pb-20">
        <div className="max-w-4xl border-l border-border pl-8 min-h-full">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
};

export default SettingsLayout;
