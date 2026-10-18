import { useId, useMemo, useState } from "react";
import { DAYS_ID } from "../../utils/analytics.js";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));

function getColorClass(value, max) {
  if (value === 0 || max === 0) return "bg-sunken/60 text-muted";
  const ratio = value / max;
  if (ratio <= 0.25) return "bg-accent/20 text-ink";
  if (ratio <= 0.5) return "bg-accent/40 text-ink";
  if (ratio <= 0.75) return "bg-accent/70 text-accent-ink";
  return "bg-accent text-accent-ink font-bold";
}

export default function HeatmapChart({
  matrix = [], // 2D array [rows x 24 cols]
  rowLabels = [], // array of row header strings
  locations = [], // optional for location coordinates in tooltip
  unitLabel = "alert",
  empty = false,
}) {
  const [activeCell, setActiveCell] = useState(null);
  const legendId = useId();

  // Calculate max value in matrix for relative color scale
  const maxValue = useMemo(() => {
    let max = 0;
    matrix.forEach((row) => {
      row.forEach((v) => {
        if (v > max) max = v;
      });
    });
    return max;
  }, [matrix]);

  if (empty || matrix.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted">
        Tidak ada data kejadian pada periode ini.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Scroll container for responsiveness on small screens */}
      <div className="overflow-x-auto pb-2" tabIndex={0} role="region" aria-label="Heatmap interaktif">
        <div className="min-w-[680px]">
          {/* Header Row: Hours 00..23 */}
          <div className="grid grid-cols-[100px_repeat(24,minmax(22px,1fr))] items-center gap-1 text-[11px] font-mono text-muted">
            <span className="text-left font-sans font-medium text-ink">Jam (WIB)</span>
            {HOURS.map((h) => (
              <span key={h} className="text-center">
                {h}
              </span>
            ))}
          </div>

          {/* Matrix Rows */}
          <div className="mt-1 flex flex-col gap-1">
            {matrix.map((row, rIdx) => {
              const label = rowLabels[rIdx] || (DAYS_ID[rIdx] ?? `Baris ${rIdx + 1}`);
              const locObj = locations[rIdx];
              return (
                <div
                  key={label}
                  className="grid grid-cols-[100px_repeat(24,minmax(22px,1fr))] items-center gap-1"
                >
                  <span
                    className="truncate text-[12px] font-medium text-ink"
                    title={locObj ? `${label} (${locObj.koordinat})` : label}
                  >
                    {label}
                  </span>
                  {row.map((val, cIdx) => {
                    const hourStr = HOURS[cIdx];
                    const tooltipText = `${label}${
                      locObj?.koordinat ? ` [${locObj.koordinat}]` : ""
                    } · Pukul ${hourStr}:00 WIB : ${val} ${unitLabel}`;
                    const color = getColorClass(val, maxValue);

                    return (
                      <div
                        key={cIdx}
                        role="button"
                        tabIndex={0}
                        aria-label={tooltipText}
                        onMouseEnter={() =>
                          setActiveCell({ label, hour: hourStr, value: val, coord: locObj?.koordinat })
                        }
                        onMouseLeave={() => setActiveCell(null)}
                        onFocus={() =>
                          setActiveCell({ label, hour: hourStr, value: val, coord: locObj?.koordinat })
                        }
                        onBlur={() => setActiveCell(null)}
                        className={`group relative flex h-7 items-center justify-center rounded-sm text-[11px] font-mono transition-transform hover:scale-110 hover:z-10 focus:outline-none focus:ring-2 focus:ring-accent ${color}`}
                      >
                        {val > 0 ? val : ""}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend & Active Cell Status */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2 text-[12px] text-muted">
        <div className="min-h-[20px]">
          {activeCell ? (
            <span className="font-medium text-ink">
              {activeCell.label} {activeCell.coord && `(${activeCell.coord})`} · Jam {activeCell.hour}:00 WIB :{" "}
              <strong className="text-accent-text font-mono">{activeCell.value}</strong> {unitLabel}
            </span>
          ) : (
            <span>Arahkan kursor atau sentuh kotak untuk melihat rincian jam ramai pelanggaran.</span>
          )}
        </div>

        <div className="flex items-center gap-2" id={legendId}>
          <span className="text-[11px]">0</span>
          <div className="flex h-3 gap-0.5">
            <span className="w-4 rounded-sm bg-sunken/60" />
            <span className="w-4 rounded-sm bg-accent/20" />
            <span className="w-4 rounded-sm bg-accent/40" />
            <span className="w-4 rounded-sm bg-accent/70" />
            <span className="w-4 rounded-sm bg-accent" />
          </div>
          <span className="text-[11px] font-mono">{maxValue}</span>
        </div>
      </div>
    </div>
  );
}
