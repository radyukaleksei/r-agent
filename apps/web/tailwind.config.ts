import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#12161B",
        surface: "#171C23",
        "surface-raised": "#1D232C",
        border: "#2A323D",
        "text-primary": "#E7EBEF",
        "text-secondary": "#8B94A3",
        accent: {
          teal: "#2FA79B",
          "teal-dim": "#1F726A",
          amber: "#E0A458",
          rose: "#D96C6C",
        },
      },
      fontFamily: {
        sans: ["var(--font-plex-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
      },
    },
  },
  plugins: [],
};

export default config;
