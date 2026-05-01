import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    extend: {
      fontFamily: {
        sans: ['"Instrument Sans"', "system-ui", "sans-serif"],
        serif: ['"Instrument Serif"', "serif"],
        display: ['"DM Sans"', "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border-soft) / 0.07)",
        "border-md": "hsl(var(--border-soft) / 0.12)",
        "border-hv": "hsl(var(--border-soft) / 0.20)",
        input: "hsl(var(--border-soft) / 0.07)",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--bg))",
        foreground: "hsl(var(--t1))",

        bg: {
          DEFAULT: "hsl(var(--bg))",
          2: "hsl(var(--bg-2))",
          3: "hsl(var(--bg-3))",
          4: "hsl(var(--bg-4))",
          5: "hsl(var(--bg-5))",
          sidebar: "hsl(var(--sidebar-bg))",
          notif: "hsl(var(--notif-bg))",
        },

        primary: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
          glow: "hsl(var(--accent-2))",
        },
        secondary: {
          DEFAULT: "hsl(var(--bg-3))",
          foreground: "hsl(var(--t1))",
        },
        destructive: {
          DEFAULT: "hsl(var(--red))",
          foreground: "hsl(0 0% 100%)",
        },
        muted: {
          DEFAULT: "hsl(var(--bg-3))",
          foreground: "hsl(var(--t2))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--notif-bg))",
          foreground: "hsl(var(--t1))",
        },
        card: {
          DEFAULT: "hsl(var(--bg-2))",
          foreground: "hsl(var(--t1))",
        },
        // Status tokens
        green: "hsl(var(--green))",
        amber: "hsl(var(--amber))",
        red: "hsl(var(--red))",
        blue: "hsl(var(--blue))",
        purple: "hsl(var(--purple))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 6px)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up":   { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        "fade-up":        { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up":   "accordion-up 0.2s ease-out",
        "fade-up":        "fade-up 0.32s cubic-bezier(0.4,0,0.2,1) both",
      },
      boxShadow: {
        elegant: "0 12px 48px hsl(0 0% 0% / 0.18), 0 4px 14px hsl(0 0% 0% / 0.10)",
        glow: "0 0 24px hsl(var(--accent) / 0.25)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
