import { motion } from "framer-motion";
import { ReactNode } from "react";

export const PageTransition = ({ children, className }: { children: ReactNode; className?: string }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={className}
      layout
    >
      {children}
    </motion.div>
  );
};

export const StaggeredList = ({ children, className }: { children: ReactNode; className?: string }) => {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: 0.05,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

export const StaggeredItem = ({ children, className }: { children: ReactNode; className?: string }) => {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 4 },
        visible: { 
          opacity: 1, 
          y: 0, 
          transition: { duration: 0.25, ease: "easeOut" } 
        },
      }}
      className={className}
      layout
    >
      {children}
    </motion.div>
  );
};
