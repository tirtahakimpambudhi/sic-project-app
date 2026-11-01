// Firmware `setupResult` codes (config/status) translated for operators.
const MESSAGES = {
  ok: "Unit baru berhasil dipasang.",
  unset_ok: "Unit berhasil dihapus.",
  default_pins: "Perangkat menyala dengan pin bawaan.",
  reserved_pin: "Pin dipakai UART0 (Serial Monitor) dan tidak boleh dipakai.",
  invalid_pin: "Pin tidak valid atau tidak mendukung output di ESP32.",
  pin_conflict_active: "Pin bentrok dengan unit yang sedang aktif.",
  pin_conflict_request: "TRIG, ECHO, dan SERVO harus memakai GPIO berbeda.",
  max_units_reached: "Jumlah unit sudah maksimum (4 termasuk unit default).",
  incomplete_unit: "Perintah belum lengkap: butuh pin TRIG, ECHO, dan SERVO.",
  no_pin_in_payload: "Perangkat tidak menemukan pin pada perintah.",
  no_unit_id_in_payload: "Perangkat tidak menemukan unitId pada perintah.",
  cannot_unset_default: "Unit 0 adalah unit default dan tidak bisa dihapus.",
  invalid_json: "Perangkat tidak bisa membaca perintah (JSON tidak valid).",
  tolerant_distance_invalid: "Jarak toleransi tidak valid.",
  tolerant_distance_out_of_range: "Jarak toleransi harus antara 0,1 dan 400 cm.",
  timeout_invalid: "Timeout tidak valid.",
  timeout_out_of_range: "Timeout harus antara 1 dan 86.400 detik.",
};

const SUCCESS = new Set(["ok", "unset_ok", "default_pins"]);

export function describeSetupResult(code) {
  if (!code) return null;
  return { success: SUCCESS.has(code), message: MESSAGES[code] ?? `Hasil dari perangkat: ${code}` };
}
