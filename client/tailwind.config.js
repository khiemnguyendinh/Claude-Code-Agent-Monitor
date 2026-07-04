/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // 2026-07-04 retheme: `surface` / `border` / `accent` used to be a
        // hardcoded dark palette for the original monitor (everything under
        // /he-thong/*). Per Khiêm's request they now resolve to the same
        // --kad-* CSS vars as the KAD screens, so the whole app renders one
        // consistent "Kstudy Flat" light theme instead of two themes. The
        // 6-step dark elevation ramp collapses onto kad's 3 flat levels
        // (bg/surface/surface-2) — flat design carries elevation via border,
        // not extra fill-color steps. See src/kad/kad-tokens.css.
        // Every entry below uses `rgb(var(--kad-x-rgb) / <alpha-value>)`
        // instead of a bare `var(--kad-x)` hex reference. Tailwind needs a
        // color in this function form to inject an alpha channel — a plain
        // hex-via-CSS-var breaks any `/NN` opacity modifier (e.g.
        // `bg-accent/15`, `ring-kad-accent/30`), which this whole app uses
        // in hundreds of places. `<alpha-value>` becomes `1` when no
        // modifier is given, so plain usage (`bg-accent`) is unaffected.
        surface: {
          0: "rgb(var(--kad-bg-rgb) / <alpha-value>)", // page canvas
          1: "rgb(var(--kad-surface-2-rgb) / <alpha-value>)", // sunken/nested-within-card
          2: "rgb(var(--kad-surface-rgb) / <alpha-value>)", // input/field fill
          3: "rgb(var(--kad-surface-rgb) / <alpha-value>)", // .card fill (primary)
          4: "rgb(var(--kad-surface-2-rgb) / <alpha-value>)", // hover / .card-hover state
          5: "rgb(var(--kad-surface-2-rgb) / <alpha-value>)", // rare topmost, same tier as hover
        },
        border: {
          DEFAULT: "rgb(var(--kad-border-rgb) / <alpha-value>)",
          light: "rgb(var(--kad-border-strong-rgb) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--kad-accent-rgb) / <alpha-value>)",
          hover: "rgb(var(--kad-accent-hover-rgb) / <alpha-value>)",
          muted: "var(--kad-accent-muted)", // already a fixed-alpha rgba() literal
        },
        // KAD ("Kstudy Flat") — light, low-contrast token set. Originally
        // scoped to the new department-workspace screens (/, /cong-viec,
        // /doi-ngu, /hoc-lieu, /bao-cao); now the single source of truth for
        // `surface`/`border`/`accent` above too, so /he-thong/* matches.
        kad: {
          bg: "rgb(var(--kad-bg-rgb) / <alpha-value>)",
          surface: "rgb(var(--kad-surface-rgb) / <alpha-value>)",
          "surface-2": "rgb(var(--kad-surface-2-rgb) / <alpha-value>)",
          border: "rgb(var(--kad-border-rgb) / <alpha-value>)",
          "border-strong": "rgb(var(--kad-border-strong-rgb) / <alpha-value>)",
          text: "rgb(var(--kad-text-rgb) / <alpha-value>)",
          "text-strong": "rgb(var(--kad-text-strong-rgb) / <alpha-value>)",
          "text-muted": "rgb(var(--kad-text-muted-rgb) / <alpha-value>)",
          "text-faint": "rgb(var(--kad-text-faint-rgb) / <alpha-value>)",
          accent: "rgb(var(--kad-accent-rgb) / <alpha-value>)",
          primary: "rgb(var(--kad-primary-rgb) / <alpha-value>)",
          success: "rgb(var(--kad-success-rgb) / <alpha-value>)",
          warning: "rgb(var(--kad-warning-rgb) / <alpha-value>)",
          danger: "rgb(var(--kad-danger-rgb) / <alpha-value>)",
          info: "rgb(var(--kad-info-rgb) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
