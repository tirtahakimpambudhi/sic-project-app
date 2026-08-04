/** Shapes mirror the Django REST API (snake_case) and the ESP32 vocabulary. */

export type UserRole = 'operator' | 'satpol_pp'
export type DetectionState = 'scanning' | 'tracking' | 'confirmed'
export type SensorStatus = 'object_detected' | 'object_not_detected'
export type UnitSource = 'default' | 'dynamic'

/** Results the firmware reports on config/status. `(string & {})` keeps autocomplete
 *  while tolerating results added by newer firmware. */
export type ConfigResult =
  | 'default_pins'
  | 'ok'
  | 'unset_ok'
  | 'invalid_json'
  | 'pin_conflict_active'
  | 'max_units_reached'
  | 'cannot_unset_default'
  | 'incomplete_unit'
  | 'no_pin_in_payload'
  | 'no_unit_id_in_payload'
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  | (string & {})

export interface User {
  id: number
  username: string
  first_name: string
  last_name: string
  role: UserRole
}

export interface DeviceUnit {
  unit_id: number
  source: UnitSource
  is_default: boolean
  has_setup: boolean
  trig_pin: number | null
  echo_pin: number | null
  servo_pin: number | null
  detection_state: DetectionState
  sensor_status: SensorStatus
  last_distance_cm: number | null
  servo_position: number | null
  last_seen_at: string | null
}

export interface Device {
  id: number
  device_id: string
  name: string
  latitude: number
  longitude: number
  tolerant_distance_cm: number
  timeout_seconds: number
  is_online: boolean
  last_seen_at: string | null
  last_operation: string
  last_config_result: ConfigResult
  last_config_detail: string
  last_config_at: string | null
  units: DeviceUnit[]
  created_at: string
}

export interface TelemetryData {
  id: number
  unit_id: number
  distance_cm: number | null
  servo_position: number | null
  detection_state: DetectionState
  sensor_status: SensorStatus
  created_at: string
}

export interface AlertData {
  id: number
  device: number
  device_name: string
  device_uid: string
  unit_id: number
  event_name: string
  alert_type: string
  message: string
  distance_cm: number | null
  latitude: number | null
  longitude: number | null
  repeat_count: number
  is_resolved: boolean
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
  updated_at: string
}

// ---- Command payloads (frontend -> API -> MQTT) ---------------------------------------

export interface GeneralConfigPayload {
  tolerant_distance_cm?: number
  timeout_seconds?: number
  latitude?: number
  longitude?: number
}

export interface SetConfigPayload extends GeneralConfigPayload {
  sensor: { trig_pin: number; echo_pin: number }
  servo: { pin: number }
}

export interface UnsetConfigPayload {
  unit_ids: number[]
}

export interface CreateDevicePayload {
  device_id: string
  name: string
  latitude: number
  longitude: number
}

export type UpdateDevicePayload = Partial<Omit<CreateDevicePayload, 'device_id'>>

export interface CommandAccepted {
  topic: string
  payload: Record<string, unknown>
}

export interface AuthTokens {
  access: string
  refresh: string
}
