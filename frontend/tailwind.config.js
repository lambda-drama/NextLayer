// /** @type {import('tailwindcss').Config} */
// module.exports = {
//   content: [],
//   theme: {
//     extend: {},
//   },
//   plugins: [],
// }

const { fontFamily } = require("tailwindcss/defaultTheme");

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Theme is toggled by adding/removing the `dark` class on <html>
  // (see `IntercompanyTopNav`), so use the class strategy instead of the
  // default `media` strategy.
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./app/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        // Popover surface tokens (dropdown/select panels). The matching CSS
        // variables exist for both `:root` and `.dark` in src/index.css, so the
        // panels flip automatically when `dark` is toggled on <html>.
        // NOTE: deliberately the only shadcn surface token registered here — the
        // other ones (card/muted/accent/destructive) are not referenced by any
        // base component in a way that is safe to switch on: page-level palette
        // classes (e.g. `bg-blue-50`, `text-blue-800`) are emitted *before* those
        // keys in Tailwind's alphabetical colour order, so registering them would
        // silently override the explicit classes used across the report pages.
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", ...fontFamily.sans],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
