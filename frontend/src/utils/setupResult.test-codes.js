// Every code the firmware contract lists for config/status.setupResult (used by the tests).
export const SETUP_CODES = [
  "ok", "unset_ok", "general_ok", "release_ok", "no_active_alert", "default_pins",
  "incomplete_unit", "no_pin_in_payload", "pin_must_be_integer", "reserved_pin", "strapping_pin",
  "input_only_pin", "pin_not_allowed", "pin_conflict_active", "duplicate_pin", "max_units_reached",
  "unit_id_invalid", "no_unit_id_in_payload", "unit_not_found", "cannot_unset_default",
  "tolerant_distance_invalid", "tolerant_distance_out_of_range", "timeout_invalid", "timeout_out_of_range",
  "no_param_in_payload", "invalid_json", "default_pins_invalid",
];
