/** Colors resolve to CSS variables (src/index.css) so light and dark share one set of names. */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: token("canvas"),
        surface: token("surface"),
        sunken: token("sunken"),
        ink: token("ink"),
        muted: token("muted"),
        line: token("line"),
        accent: token("accent"),
        "accent-strong": token("accent-strong"),
        "accent-ink": token("accent-ink"),
        "accent-soft": token("accent-soft"),
        "accent-text": token("accent-text"),
        tech: token("tech"),
        "tech-soft": token("tech-soft"),
        "tech-text": token("tech-text"),
        danger: token("danger"),
        "danger-soft": token("danger-soft"),
        "on-danger": token("on-danger"),
        warn: token("warn"),
        "warn-soft": token("warn-soft"),
        "warn-text": token("warn-text"),
        ok: token("ok"),
        "ok-soft": token("ok-soft"),
      },
      fontFamily: {
        sans: ['"Inter Variable"', "system-ui", "Segoe UI", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', "ui-monospace", "Menlo", "monospace"],
      },
      borderRadius: { panel: "8px", control: "6px" },
    },
  },
  plugins: [],
};
