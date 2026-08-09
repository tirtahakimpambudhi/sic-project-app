import { useId } from "react";

/** Label + control + hint/error wired together for screen readers. */
export default function Field({ label, hint, error, children, className = "" }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label className="label" htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-[13px] font-medium text-danger">{error}</p>
      ) : (
        hint && <p id={`${id}-hint`} className="hint">{hint}</p>
      )}
    </div>
  );
}
