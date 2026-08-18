// Status is never color alone: filled dot = active condition, hollow ring = idle/unknown, plus a text label.
const TONES = {
  ok: { text: "text-ok", dot: "bg-ok" },
  tech: { text: "text-tech-text", dot: "bg-tech" },
  danger: { text: "text-danger", dot: "bg-danger" },
  warn: { text: "text-warn-text", dot: "bg-warn" },
  neutral: { text: "text-muted", ring: "border-muted" },
  offline: { text: "text-muted", ring: "border-muted" },
};

export default function StatusBadge({ tone = "neutral", children }) {
  const style = TONES[tone] ?? TONES.neutral;
  return (
    <span className={`inline-flex items-center gap-2 text-[13px] font-semibold ${style.text}`}>
      <span
        aria-hidden
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot ?? `border-2 ${style.ring}`}`}
      />
      {children}
    </span>
  );
}
