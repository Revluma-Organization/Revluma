import { ReactNode } from "react";
import { motion } from "framer-motion";
import { DESIGN_TOKENS } from "@/lib/DesignConstants";

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, badge, actions }: PageHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-2"
    >
      <div>
        <div className="flex items-center gap-3">
          <h1 className={`display text-[1.6rem] font-extrabold tracking-tight sm:text-[1.85rem] ${DESIGN_TOKENS.primaryText}`}>
            {title}
          </h1>
          {badge && <div>{badge}</div>}
        </div>
        {subtitle && (
          <p className={`mt-1 text-[0.85rem] max-w-2xl ${DESIGN_TOKENS.secondaryText}`}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">
          {actions}
        </div>
      )}
    </motion.div>
  );
}
