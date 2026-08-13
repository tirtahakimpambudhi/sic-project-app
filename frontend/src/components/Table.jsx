/** Horizontal-scroll wrapper so wide tables never push the page sideways on phones. */
export default function Table({ children, label }) {
  return (
    <div className="overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      <table className="data-table">{children}</table>
    </div>
  );
}
