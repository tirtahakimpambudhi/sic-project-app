import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * Accessible modal built on the native <dialog>: the browser handles the focus trap, Esc and inertness
 * of the page behind. Children only mount while open, so forms always start from a clean state.
 */
export default function Modal({ open, onClose, title, description, children, footer, size = "md" }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal ${size === "lg" ? "!max-w-xl" : ""}`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose(); // click on the backdrop
      }}
      aria-labelledby="modal-title"
    >
      {open && (
        <div>
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id="modal-title" className="text-base font-semibold">{title}</h2>
              {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
              aria-label="Tutup"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </header>
          <div className="px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
