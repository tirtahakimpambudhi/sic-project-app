import assert from "node:assert/strict";
import { test } from "node:test";
import { SETUP_CODES } from "./setupResult.test-codes.js";
import { describeSetupResult } from "./setupResult.js";
import { deviceHealth, formatReading, isAlarm, nearestDistance } from "./format.js";
import { addUnitBlocker, buildAddUnitBody, validateGeneral, validateUnitPins } from "./pins.js";

const unit0 = { unit_id: 0, trig_pin: 22, echo_pin: 21, servo_pin: 23, buzzer_pin: 19 };
const esp32 = (units = [unit0], type = "ESP32") => ({ device_type: type, units });
const form = (trig, echo, servo, buzzer) => ({ trig_pin: trig, echo_pin: echo, servo_pin: servo, buzzer_pin: buzzer });

test("add unit: valid ESP32 pins pass and the body carries all four pins", () => {
  const values = form("25", "26", "27", "32");
  assert.deepEqual(validateUnitPins(esp32(), values), {});
  assert.deepEqual(buildAddUnitBody(values), { trig_pin: 25, echo_pin: 26, servo_pin: 27, buzzer_pin: 32 });
});

test("add unit: rejects pins outside the allowlist", () => {
  const errors = validateUnitPins(esp32(), form("25", "26", "27", "2"));
  assert.match(errors.buzzer_pin, /tidak diizinkan/);
});

test("add unit: rejects duplicate pins inside the form", () => {
  const errors = validateUnitPins(esp32(), form("25", "25", "27", "32"));
  assert.ok(errors.echo_pin);
});

test("add unit: rejects pins used by an active unit", () => {
  const errors = validateUnitPins(esp32(), form("22", "26", "27", "32"));
  assert.match(errors.trig_pin, /unit 0/);
});

test("add unit: a missing pin is an error (buzzer is mandatory)", () => {
  assert.ok(validateUnitPins(esp32(), form("25", "26", "27", "")).buzzer_pin);
});

test("add unit: blocked until deviceType is known, and for unknown types", () => {
  assert.match(addUnitBlocker({ units: [unit0] }), /Menunggu status/);
  assert.match(addUnitBlocker(esp32([unit0], "ESP9999")), /belum dikenal/);
});

test("add unit: blocked at 4 units and when fewer than 4 pins remain", () => {
  const four = [0, 1, 2, 3].map((unit_id) => ({ unit_id }));
  assert.match(addUnitBlocker(esp32(four)), /Slot penuh/);
  const esp8266 = { device_type: "ESP8266", units: [{ unit_id: 0, trig_pin: 12, echo_pin: 14, servo_pin: 13, buzzer_pin: 5 }] };
  assert.match(addUnitBlocker(esp8266), /Pin yang tersisa hanya 1/);
});

test("add unit: ESP32 capacity is 3 units, ESP32-S3 has room for 4", () => {
  const three = [
    unit0,
    { unit_id: 1, trig_pin: 25, echo_pin: 26, servo_pin: 27, buzzer_pin: 32 },
    { unit_id: 2, trig_pin: 4, echo_pin: 13, servo_pin: 16, buzzer_pin: 17 },
  ];
  assert.match(addUnitBlocker(esp32(three)), /Pin yang tersisa hanya 2/);
  assert.equal(addUnitBlocker({ device_type: "ESP32-S3", units: [{ unit_id: 0, trig_pin: 4, echo_pin: 5, servo_pin: 6, buzzer_pin: 7 }] }), null);
});

test("general: timeout 0 and 100000 are rejected, tolerance 0 and 401 too", () => {
  assert.ok(validateGeneral({ tolerant_distance_cm: "10", timeout_seconds: "0" }).timeout_seconds);
  assert.ok(validateGeneral({ tolerant_distance_cm: "10", timeout_seconds: "100000" }).timeout_seconds);
  assert.ok(validateGeneral({ tolerant_distance_cm: "0", timeout_seconds: "60" }).tolerant_distance_cm);
  assert.ok(validateGeneral({ tolerant_distance_cm: "401", timeout_seconds: "60" }).tolerant_distance_cm);
  assert.ok(validateGeneral({ tolerant_distance_cm: "10", timeout_seconds: "1.5" }).timeout_seconds);
  assert.deepEqual(validateGeneral({ tolerant_distance_cm: "0.5", timeout_seconds: "86400" }), {});
});

test("every firmware setupResult code has a message; no_active_alert is info, not error", () => {
  for (const code of SETUP_CODES) {
    const result = describeSetupResult(code);
    assert.ok(result.message && !result.message.startsWith("Hasil dari perangkat"), code);
  }
  assert.equal(describeSetupResult("no_active_alert").kind, "info");
  assert.equal(describeSetupResult("release_ok").kind, "success");
  assert.equal(describeSetupResult("unit_not_found").kind, "error");
  assert.equal(describeSetupResult("some_future_code").kind, "error");
});

test("alarm: follows is_object_detected, falls back to confirmed for old firmware", () => {
  assert.equal(isAlarm({ is_object_detected: true, detection_state: "scanning" }), true);
  assert.equal(isAlarm({ is_object_detected: false, detection_state: "confirmed" }), false);
  assert.equal(isAlarm({ detection_state: "confirmed" }), true); // old firmware
  assert.equal(isAlarm({}), false); // missing fields never crash
});

test("health: latched alarm wins; offline overrides", () => {
  const latched = { is_online: true, units: [{ is_object_detected: true, detection_state: "scanning" }] };
  assert.equal(deviceHealth(latched).key, "alert");
  assert.equal(deviceHealth({ ...latched, is_online: false }).key, "offline");
  assert.equal(deviceHealth({ is_online: true, units: [{}] }).key, "ok");
});

test("distance: 999.9 means no echo and never counts as nearest", () => {
  assert.equal(formatReading(999.9), "tidak ada objek");
  assert.equal(nearestDistance({ units: [{ last_distance_cm: 999.9 }, { last_distance_cm: 42 }] }), 42);
  assert.equal(nearestDistance({ units: [{ last_distance_cm: 999.9 }] }), null);
});
