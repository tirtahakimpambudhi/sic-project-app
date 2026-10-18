import { Skeleton } from "../Skeleton.jsx";

const TONES = {
  accent: "text-accent-text border-accent-soft bg-accent-soft/20",
  danger: "text-danger border-danger-soft bg-danger-soft/20",
  warn: "text-warn-text border-warn-soft bg-warn-soft/20",
  ok: "text-ok border-ok-soft bg-ok-soft/20",
  tech: "text-tech-text border-tech-soft bg-tech-soft/20",
  neutral: "text-ink border-line bg-surface",
};

export default function KpiCard({ title, value, subtitle, icon: Icon, tone = "neutral", loading = false }) {
  const toneStyle = TONES[tone] || TONES.neutral;

  return (
    <div className="panel flex flex-col justify-between p-4 transition-all">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium text-muted">{title}</span>
        {Icon && (
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-control border ${toneStyle}`}>
            <Icon className="h-4 w-4" aria-hidden />
          </div>
        )}
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="h-8 w-24 animate-pulse rounded bg-sunken" />
        ) : (
          <p className="font-mono text-2xl font-bold tracking-tight text-ink">{value}</p>
        )}
        {subtitle && (
          <div className="mt-1 text-[12px] text-muted">
            {loading ? <Skeleton className="h-3 w-20" /> : subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
