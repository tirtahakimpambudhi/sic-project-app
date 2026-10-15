// Firmware `setupResult` codes (config/status) translated for operators.
// kind: "success" = operation done, "info" = informational (not an error), "error" = rejected by the firmware.
const MESSAGES = {
  // success
  ok: { kind: "success", message: "Unit baru berhasil dipasang." },
  unset_ok: { kind: "success", message: "Unit berhasil dihapus." },
  general_ok: { kind: "success", message: "Parameter umum berhasil diterapkan." },
  release_ok: { kind: "success", message: "Alarm berhasil dilepas. Unit kembali memindai." },
  default_pins: { kind: "success", message: "Perangkat menyala dengan pin bawaan." },

  // information
  no_active_alert: { kind: "info", message: "Tidak ada alarm aktif yang perlu dilepas." },

  // pins and units
  incomplete_unit: { kind: "error", message: "Perintah belum lengkap: butuh pin TRIG, ECHO, SERVO, dan BUZZER." },
  no_pin_in_payload: { kind: "error", message: "Perangkat tidak menemukan pin pada perintah." },
  pin_must_be_integer: { kind: "error", message: "Nomor pin harus berupa bilangan bulat." },
  reserved_pin: { kind: "error", message: "Pin dicadangkan sistem (mis. UART0 / flash) dan tidak boleh dipakai." },
  strapping_pin: { kind: "error", message: "Pin ini adalah strapping pin dan tidak aman dipakai." },
  input_only_pin: { kind: "error", message: "Pin ini hanya mendukung input, tidak bisa dipakai untuk output." },
  pin_not_allowed: { kind: "error", message: "Pin tidak diizinkan untuk tipe mikrokontroler ini." },
  pin_conflict_active: { kind: "error", message: "Pin bentrok dengan unit yang sedang aktif." },
  duplicate_pin: { kind: "error", message: "TRIG, ECHO, SERVO, dan BUZZER harus memakai GPIO yang berbeda." },
  max_units_reached: { kind: "error", message: "Jumlah unit sudah maksimum." },

  // unitId
  unit_id_invalid: { kind: "error", message: "unitId tidak valid." },
  no_unit_id_in_payload: { kind: "error", message: "Perangkat tidak menemukan unitId pada perintah." },
  unit_not_found: { kind: "error", message: "Unit tidak ditemukan di perangkat." },
  cannot_unset_default: { kind: "error", message: "Unit 0 adalah unit default dan tidak bisa dihapus." },

  // parameters
  tolerant_distance_invalid: { kind: "error", message: "Jarak toleransi tidak valid." },
  tolerant_distance_out_of_range: { kind: "error", message: "Jarak toleransi harus lebih dari 0 dan maksimal 400 cm." },
  timeout_invalid: { kind: "error", message: "Timeout tidak valid." },
  timeout_out_of_range: { kind: "error", message: "Timeout harus antara 1 dan 86.400 detik." },
  no_param_in_payload: { kind: "error", message: "Perintah tidak berisi parameter apa pun (isi minimal satu)." },

  // general
  invalid_json: { kind: "error", message: "Perangkat tidak bisa membaca perintah (JSON tidak valid)." },
  default_pins_invalid: { kind: "error", message: "Pin bawaan unit 0 tidak valid untuk perangkat ini (saat boot)." },

  // codes from older firmware, kept so old status data still reads well
  invalid_pin: { kind: "error", message: "Pin tidak valid atau tidak mendukung output." },
  pin_conflict_request: { kind: "error", message: "Pin pada perintah tidak boleh kembar." },
};

/**
 * @param {string | null | undefined} code
 * @returns {{ kind: "success" | "info" | "error", success: boolean, message: string } | null}
 */
export function describeSetupResult(code) {
  if (!code) return null;
  const known = MESSAGES[code];
  if (known) return { ...known, success: known.kind !== "error" };
  return { kind: "error", success: false, message: `Hasil dari perangkat: ${code}` };
}
