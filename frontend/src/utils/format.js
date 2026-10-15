const rtf = new Intl.RelativeTimeFormat("id", { numeric: "auto" });
const number = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

export function timeAgo(iso) {
  if (!iso) return "belum pernah";
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 5) return "baru saja";
  if (abs < 60) return rtf.format(seconds, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86400), "day");
}

export function formatDateTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export function formatClock(date) {
  return date ? date.toLocaleTimeString("en-GB") : "-";
}

/** The firmware reports 999.9 cm when the sensor got no echo (nothing in range). */
export const NO_ECHO_CM = 999.9;

export function hasEcho(cm) {
  return cm !== null && cm !== undefined && cm < NO_ECHO_CM;
}

export function formatDistance(cm) {
  return cm === null || cm === undefined ? "-" : `${number.format(cm)} cm`;
}

/** A live sensor reading: "tidak ada objek" instead of the 999.9 cm no-echo sentinel. */
export function formatReading(cm) {
  if (cm === null || cm === undefined) return "-";
  return hasEcho(cm) ? formatDistance(cm) : "tidak ada objek";
}

export function mapsUrl(latitude, longitude) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

export const DETECTION_STATE = {
  scanning: { label: "Memindai", tone: "neutral" },
  tracking: { label: "Melacak objek", tone: "warn" },
  confirmed: { label: "Terkonfirmasi", tone: "danger" },
};

export function detectionState(state) {
  return DETECTION_STATE[state] ?? { label: state || "-", tone: "neutral" };
}

/**
 * One health value per device, worst unit wins: confirmed violation > tracking > scanning.
 * Offline overrides everything because stale unit states cannot be trusted.
 */
export const HEALTH = {
  alert: { key: "alert", label: "Pelanggaran terkonfirmasi", short: "Pelanggaran", tone: "danger", rank: 0 },
  tracking: { key: "tracking", label: "Objek terdeteksi", short: "Terdeteksi", tone: "warn", rank: 1 },
  ok: { key: "ok", label: "Aman", short: "Aman", tone: "ok", rank: 2 },
  offline: { key: "offline", label: "Offline", short: "Offline", tone: "offline", rank: 3 },
};

/**
 * True while a unit's alarm is latched (it stays on, even after the object left, until released).
 * Firmware without `is_object_detected` falls back to the confirmed state.
 */
export function isAlarm(unit) {
  return unit.is_object_detected ?? unit.detection_state === "confirmed";
}

export function deviceHealth(device) {
  if (!device.is_online) return HEALTH.offline;
  if (device.units.some(isAlarm)) return HEALTH.alert;
  if (device.units.some((unit) => unit.detection_state === "tracking")) return HEALTH.tracking;
  return HEALTH.ok;
}

/** "T / E / S / B" pin string; "-" for pins the device has not reported (older firmware has no buzzer). */
export function formatPins(unit, separator = " / ") {
  return [unit.trig_pin, unit.echo_pin, unit.servo_pin, unit.buzzer_pin].map((pin) => pin ?? "-").join(separator);
}

/** Smallest live distance reading among a device's units, or null when no unit sees an object. */
export function nearestDistance(device) {
  const readings = device.units.map((unit) => unit.last_distance_cm).filter(hasEcho);
  return readings.length ? Math.min(...readings) : null;
}

export function formatSeconds(total) {
  if (total >= 3600 && total % 3600 === 0) return `${total / 3600} jam`;
  if (total >= 60 && total % 60 === 0) return `${total / 60} menit`;
  return `${total} dtk`;
}
