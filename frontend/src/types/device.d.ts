/**
 * Shapes returned by the Django REST API (snake_case) for the ESP32 "Slop" firmware.
 * Use from JS with JSDoc: `@param {import("../types/device").Device} device`.
 *
 * Fields marked optional are new in the latest firmware and are `undefined` for data from older firmware,
 * so UI code must never assume they exist.
 */

export type DetectionState = "scanning" | "tracking" | "confirmed";
export type DeviceType = "ESP32" | "ESP8266" | "ESP32-S3";

export type SetupResultCode =
  | "ok" | "unset_ok" | "general_ok" | "release_ok" | "no_active_alert" | "default_pins"
  | "incomplete_unit" | "no_pin_in_payload" | "pin_must_be_integer" | "reserved_pin" | "strapping_pin"
  | "input_only_pin" | "pin_not_allowed" | "pin_conflict_active" | "duplicate_pin" | "max_units_reached"
  | "unit_id_invalid" | "no_unit_id_in_payload" | "unit_not_found" | "cannot_unset_default"
  | "tolerant_distance_invalid" | "tolerant_distance_out_of_range" | "timeout_invalid" | "timeout_out_of_range"
  | "no_param_in_payload" | "invalid_json" | "default_pins_invalid"
  | (string & {}); // tolerate codes added by newer firmware

export type DeviceOperation = "boot" | "set" | "unset" | "general" | "release";

export interface DeviceUnit {
  unit_id: number;
  is_default: boolean;
  has_setup: boolean;
  detection_state: DetectionState | null;
  last_distance_cm: number | null; // 999.9 = no echo
  servo_position: number | null;
  trig_pin: number | null;
  echo_pin: number | null;
  servo_pin: number | null;
  last_seen: string | null; // server time; the firmware `timestamp` is uptime, never a date
  // new
  buzzer_pin?: number | null;
  /** Alarm latched: stays true until released, even after the object left. */
  is_object_detected?: boolean;
  buzzer_active?: boolean;
}

export interface Device {
  device_id: string;
  name: string;
  latitude: number;
  longitude: number;
  tolerant_distance_cm: number;
  timeout_seconds: number;
  is_online: boolean;
  last_seen: string | null;
  open_alert_count?: number;
  units: DeviceUnit[];
  // config/status report
  last_operation?: DeviceOperation | string;
  setup_result?: SetupResultCode | null;
  setup_detail?: string | null;
  setup_reported_at?: string | null;
  // new
  device_type?: DeviceType | string | null;
}

// ---- command bodies (frontend -> API; the API publishes the MQTT message) ----

/** POST /devices/:id/units/ -> config/set. All four pins are mandatory. */
export interface AddUnitBody {
  trig_pin: number;
  echo_pin: number;
  servo_pin: number;
  buzzer_pin: number;
}

/** POST /devices/:id/units/unset/ -> config/unset */
export interface UnsetUnitsBody {
  unit_ids: number[];
}

/** POST /devices/:id/units/release/ -> release. `{}` releases every alarming unit. */
export type ReleaseBody = {} | { unit_ids: number[] };

/** PATCH /devices/:id/ -> config/general (at least one of the two for the board). */
export interface GeneralBody {
  tolerant_distance_cm?: number; // 0 < v <= 400
  timeout_seconds?: number; // integer 1..86400
}
