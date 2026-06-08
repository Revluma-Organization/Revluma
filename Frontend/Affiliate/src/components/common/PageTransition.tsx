import { type ReactNode } from 'react';

export default function PageTransition({ children }: { children: ReactNode }) {
  return (
    <div style={{
      animation: 'fadeIn 0.2s ease-out',
    }}>
      {children}
    </div>
  );
}
