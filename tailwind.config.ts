import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-geist)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-ibm-plex-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        ink: {
          950: "#07080c",
          900: "#0c0e14",
          800: "#141824",
          700: "#1c2230",
        },
        mesh: {
          300: "#7ee0c8",
          400: "#3ee0b8",
          500: "#14c9a3",
          600: "#0ea585",
        },
        warn: {
          400: "#f5b942",
        },
      },
      boxShadow: {
        glow: "0 0 80px var(--mm-glow)",
      },
    },
  },
  plugins: [],
};

export default config;
