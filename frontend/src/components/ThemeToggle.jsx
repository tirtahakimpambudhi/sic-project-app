import { Moon, Sun } from "lucide-react";
import { useTheme } from "../context/ThemeContext.jsx";

/** Icon button, or a labelled row when `showLabel` is set (sidebar). */
export default function ThemeToggle({ showLabel = false, className = "" }) {
  const { isDark, toggle } = useTheme();
  const Icon = isDark ? Sun : Moon;
  const label = isDark ? "Mode terang" : "Mode gelap";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Beralih ke ${label.toLowerCase()}`}
      title={label}
      className={`inline-flex min-h-[40px] items-center gap-3 rounded-control px-2.5 text-sm font-semibold text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink ${className}`}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {showLabel && label}
    </button>
  );
}
