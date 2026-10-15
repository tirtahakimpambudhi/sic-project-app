// Pins a unit may use (trig, echo, servo AND buzzer), per microcontroller type.
// Source: firmware contract. The firmware stays the final judge; this only saves the operator a round trip.

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export const PINS_PER_UNIT = 4;
export const MAX_UNITS = 4;

export const PIN_ALLOWLIST = {
  ESP32: [4, 13, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33],
  ESP8266: [4, 5, 12, 13, 14],
  "ESP32-S3": [...range(1, 21), ...range(33, 42), 47, 48],
};

// NodeMCU silk-screen names, shown next to the GPIO number.
const ESP8266_LABELS = { 4: "D2", 5: "D1", 12: "D6", 13: "D7", 14: "D5" };

export const PIN_FIELDS = [
  { key: "trig_pin", label: "Pin TRIG" },
  { key: "echo_pin", label: "Pin ECHO" },
  { key: "servo_pin", label: "Pin SERVO" },
  { key: "buzzer_pin", label: "Pin BUZZER" },
];

/** Allowed pins for a device type, or null while the type is unknown/unsupported. */
export function allowedPins(deviceType) {
  return (deviceType && PIN_ALLOWLIST[deviceType]) || null;
}

export function pinLabel(deviceType, pin) {
  return deviceType === "ESP8266" && ESP8266_LABELS[pin] ? `GPIO ${pin} (${ESP8266_LABELS[pin]})` : `GPIO ${pin}`;
}

/** Map of pin -> unitId for every pin the active units currently use (units without pin data are skipped). */
export function usedPins(units) {
  const used = new Map();
  for (const unit of units ?? []) {
    for (const { key } of PIN_FIELDS) {
      const pin = unit[key];
      if (pin !== null && pin !== undefined) used.set(Number(pin), unit.unit_id);
    }
  }
  return used;
}

/**
 * Why a new unit cannot be added at all (before any pin is chosen), or null when it can.
 * @returns {string | null}
 */
export function addUnitBlocker(device) {
  const type = device.device_type;
  if (!type) return "Menunggu status dari perangkat (jenis mikrokontroler belum diketahui). Form aktif setelah perangkat melapor.";
  const allowed = allowedPins(type);
  if (!allowed) return `Jenis perangkat “${type}” belum dikenal, jadi pin tidak bisa divalidasi di sini.`;
  if (device.units.length >= MAX_UNITS) return `Slot penuh: maksimum ${MAX_UNITS} unit. Hapus unit dinamis untuk menambah yang baru.`;
  const free = allowed.filter((pin) => !usedPins(device.units).has(pin));
  if (free.length < PINS_PER_UNIT) {
    return `Pin yang tersisa hanya ${free.length}, sedangkan satu unit butuh ${PINS_PER_UNIT} pin. Kapasitas ${type} sudah habis.`;
  }
  return null;
}

/**
 * Validates the add-unit form. `values` holds the four pin fields as strings ("" = empty).
 * @returns {Record<string, string>} field key -> error message (empty object = valid)
 */
export function validateUnitPins(device, values) {
  const errors = {};
  const allowed = allowedPins(device.device_type) ?? [];
  const used = usedPins(device.units);
  const seen = new Map();

  for (const { key, label } of PIN_FIELDS) {
    const raw = values[key];
    if (raw === "" || raw === undefined || raw === null) {
      errors[key] = `${label} wajib diisi.`;
      continue;
    }
    const pin = Number(raw);
    if (!Number.isInteger(pin)) errors[key] = `${label} harus berupa bilangan bulat.`;
    else if (!allowed.includes(pin)) errors[key] = `GPIO ${pin} tidak diizinkan untuk ${device.device_type}.`;
    else if (used.has(pin)) errors[key] = `GPIO ${pin} sudah dipakai unit ${used.get(pin)}.`;
    else if (seen.has(pin)) errors[key] = `GPIO ${pin} sudah dipilih untuk ${seen.get(pin)}.`;
    else seen.set(pin, label);
  }
  return errors;
}

/** The body sent to the API for a new unit. Always carries all four pins. */
export function buildAddUnitBody(values) {
  return Object.fromEntries(PIN_FIELDS.map(({ key }) => [key, Number(values[key])]));
}

// ---- global parameters (config/general) ------------------------------------------------

export const GENERAL_LIMITS = { toleranceMax: 400, timeoutMin: 1, timeoutMax: 86400 };

/** @returns {Record<string, string>} field -> error message */
export function validateGeneral({ tolerant_distance_cm, timeout_seconds }) {
  const errors = {};
  const tolerance = Number(tolerant_distance_cm);
  if (String(tolerant_distance_cm).trim() === "" || Number.isNaN(tolerance)) {
    errors.tolerant_distance_cm = "Jarak toleransi wajib diisi dengan angka.";
  } else if (tolerance <= 0 || tolerance > GENERAL_LIMITS.toleranceMax) {
    errors.tolerant_distance_cm = `Jarak toleransi harus lebih dari 0 dan maksimal ${GENERAL_LIMITS.toleranceMax} cm.`;
  }
  const timeout = Number(timeout_seconds);
  if (String(timeout_seconds).trim() === "" || Number.isNaN(timeout)) {
    errors.timeout_seconds = "Batas waktu wajib diisi dengan angka.";
  } else if (!Number.isInteger(timeout) || timeout < GENERAL_LIMITS.timeoutMin || timeout > GENERAL_LIMITS.timeoutMax) {
    errors.timeout_seconds = `Batas waktu harus bilangan bulat ${GENERAL_LIMITS.timeoutMin} sampai 86.400 detik.`;
  }
  return errors;
}
