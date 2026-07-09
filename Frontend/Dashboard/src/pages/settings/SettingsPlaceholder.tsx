import { FC } from "react";
import { motion } from "framer-motion";

interface Props {
  title: string;
}

const SettingsPlaceholder: FC<Props> = ({ title }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6 max-w-4xl"
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          This settings page is currently under construction.
        </p>
      </div>

      <div className="border border-dashed rounded-lg h-64 flex flex-col items-center justify-center text-muted-foreground bg-muted/20">
        <p>Coming Soon</p>
      </div>
    </motion.div>
  );
};

export default SettingsPlaceholder;
