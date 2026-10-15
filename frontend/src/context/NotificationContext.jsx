import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

const NotificationContext = createContext(null);
const LIFETIME_MS = 5000;

export function NotificationProvider({ children }) {
  const [items, setItems] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setItems((list) => list.filter((item) => item.id !== id)), []);

  const notify = useCallback(
    (message, tone = "success") => {
      const id = nextId.current++;
      setItems((list) => [...list, { id, message, tone }]);
      setTimeout(() => dismiss(id), LIFETIME_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[2000] flex flex-col items-center gap-2 px-4"
        role="status"
        aria-live="polite"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-control border border-line bg-surface px-4 py-3 text-sm shadow-[0_6px_20px_-8px_rgb(0_0_0/0.25)]"
          >
            {item.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />
            ) : item.tone === "info" ? (
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-tech-text" aria-hidden />
            ) : (
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
            )}
            <p className="min-w-0 flex-1 break-words">{item.message}</p>
            <button className="text-muted hover:text-ink" onClick={() => dismiss(item.id)} aria-label="Tutup pemberitahuan">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("useNotification must be used inside NotificationProvider");
  return context;
}
