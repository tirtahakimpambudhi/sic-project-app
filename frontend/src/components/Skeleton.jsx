export function Skeleton({ className = "" }) {
  return <div className={`skeleton h-4 ${className}`} aria-hidden />;
}

/** Placeholder rows that mirror the final row height, so content does not jump on load. */
export function SkeletonRows({ rows = 3 }) {
  return (
    <div className="divide-y divide-line" role="status" aria-label="Memuat data">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-4">
          <Skeleton className="w-40" />
          <Skeleton className="w-24" />
          <Skeleton className="ml-auto w-16" />
        </div>
      ))}
    </div>
  );
}
