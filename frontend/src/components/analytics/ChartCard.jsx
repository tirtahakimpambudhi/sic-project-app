import EmptyState from "../EmptyState.jsx";
import { formatLocationSubtitle } from "../../utils/analytics.js";

export default function ChartCard({
  title,
  subtitle,
  locations,
  actions,
  loading = false,
  empty = false,
  emptyMessage = "Belum ada data untuk periode dan filter ini.",
  children,
  className = "",
  minHeight = "min-h-[300px]",
}) {
  // If subtitle is not explicitly provided, generate the mandatory location subtitle
  const locSubtitle = subtitle || (locations ? formatLocationSubtitle(locations) : null);

  return (
    <section className={`panel flex flex-col ${className}`}>
      <header className="panel-head flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line p-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          {locSubtitle && (
            <p className="mt-0.5 text-[12px] text-muted font-mono leading-relaxed" title={locSubtitle}>
              {locSubtitle}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>

      <div className={`relative flex-1 p-4 ${minHeight} flex flex-col justify-center`}>
        {loading ? (
          <div className="flex h-full w-full min-h-[200px] flex-col items-center justify-center gap-3">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <p className="text-[13px] text-muted">Memuat data...</p>
          </div>
        ) : empty ? (
          <EmptyState description={emptyMessage} />
        ) : (
          children
        )}
      </div>
    </section>
  );
}
