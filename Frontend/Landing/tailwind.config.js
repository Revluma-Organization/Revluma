/** Revluma landing — design tokens.
 *  Layout and rhythm follow the approved hero reference; the accent is
 *  Revluma's deep indigo (shared with the app) instead of the reference green. */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Instrument Sans Variable"', "system-ui", "sans-serif"],
      },
      colors: {
        canvas: "#FBFAF8",
        ink: { DEFAULT: "#0C0A1D", soft: "#3F3D4E", muted: "#6E6C7A", faint: "#A3A1AE" },
        line: "#E8E6E1",
        indigo: { deep: "#1F06AC", brand: "#2B13CF", light: "#7460FF", wash: "#EEEBFF" },
      },
      maxWidth: { page: "1240px" },
      boxShadow: {
        float: "0 18px 40px -18px rgba(12,10,29,0.28), 0 2px 6px rgba(12,10,29,0.06)",
      },
    },
  },
  plugins: [],
};
