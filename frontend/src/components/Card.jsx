/** Single-level container: a bordered panel with an optional header row. Never nested. */
export default function Card({ title, description, actions, children, className = "", bodyClassName = "" }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
