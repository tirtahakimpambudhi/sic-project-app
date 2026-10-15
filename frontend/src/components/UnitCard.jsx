import { BellRing, Unlock, Volume2, VolumeX } from "lucide-react";
import { detectionState, formatPins, formatReading, isAlarm, timeAgo } from "../utils/format.js";
import Button from "./Button.jsx";
import StatusBadge from "./StatusBadge.jsx";

/** Buzzer state; "not reported" (older firmware) is shown as such instead of guessing "off". */
function BuzzerIndicator({ active }) {
  if (active === undefined || active === null) return <span className="text-muted">tidak dilaporkan</span>;
  return active ? (
    <span className="inline-flex items-center gap-1.5 font-semibold text-danger">
      <Volume2 className="h-4 w-4" aria-hidden /> Menyala
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-muted">
      <VolumeX className="h-4 w-4" aria-hidden /> Mati
    </span>
  );
}

/**
 * One unit = one card (key it by unit_id). The alarm badge and release button follow `is_object_detected`,
 * so they clear as soon as the next telemetry/status says the alarm is released.
 */
export default function UnitCard({ unit, onRelease, releaseDisabled }) {
  const alarm = isAlarm(unit);
  const hasData = unit.has_setup || unit.detection_state;
  const state = detectionState(unit.detection_state);

  return (
    <article
      className={`panel p-4 ${alarm ? "border-danger" : ""}`}
      aria-label={`Unit ${unit.unit_id}${alarm ? ", alarm aktif" : ""}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold">
          Unit {unit.unit_id}
          <span className="ml-2 text-[12px] font-normal text-muted">{unit.is_default ? "default" : "dinamis"}</span>
        </h3>
        {hasData ? <StatusBadge tone={state.tone}>{state.label}</StatusBadge> : <span className="text-[13px] text-muted">Menunggu data</span>}
      </header>

      {alarm && (
        <p
          role="status"
          className="mt-3 inline-flex items-center gap-2 rounded-control bg-danger px-3 py-1.5 text-[13px] font-bold tracking-wide text-on-danger"
        >
          <BellRing className="h-4 w-4" aria-hidden /> ALARM AKTIF
        </p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
        <div>
          <dt className="text-[13px] text-muted">Jarak</dt>
          <dd className="font-medium">{formatReading(unit.last_distance_cm)}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted">Servo</dt>
          <dd className="font-medium">{unit.servo_position != null ? `${unit.servo_position}°` : "-"}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted">Buzzer</dt>
          <dd className="font-medium"><BuzzerIndicator active={unit.buzzer_active} /></dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted">Update</dt>
          <dd className="text-muted">{timeAgo(unit.last_seen)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[13px] text-muted">Pin TRIG / ECHO / SERVO / BUZZER</dt>
          <dd className="font-mono text-[13px]">{formatPins(unit)}</dd>
        </div>
      </dl>

      <div className="mt-4 border-t border-line pt-3">
        <Button
          size="sm"
          variant={alarm ? "danger" : "secondary"}
          icon={Unlock}
          disabled={!alarm || releaseDisabled}
          onClick={() => onRelease(unit.unit_id)}
        >
          Lepas alarm
        </Button>
      </div>
    </article>
  );
}
