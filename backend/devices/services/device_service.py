"""Device business logic: validates operator intent, then publishes MQTT commands.

Views stay thin and models stay passive. Commands are *requests*: the board validates them again and
reports the outcome on config/status, which the MQTT listener writes back to the database. Nothing here
mutates DeviceUnit rows, so the UI only ever shows what the hardware confirmed.
"""
from typing import Iterable

from devices.models import Device, DeviceUnit
from devices.services import mqtt_service

MAX_UNITS = 4  # unit 0 (default) + 3 dynamic slots
DEFAULT_UNIT_ID = 0
DEFAULT_PINS = {"trig": 22, "echo": 21, "servo": 23}  # firmware unit 0 (main.cpp)

# ESP32 (classic) pin rules mirrored from the firmware so errors surface before a round trip.
UART0_PINS = {1, 3}
FLASH_PINS = set(range(6, 12))
NONEXISTENT_PINS = {24, 28, 29, 30, 31}
INPUT_ONLY_PINS = set(range(34, 40))
MAX_GPIO = 39


class DeviceCommandError(Exception):
    """A command was rejected at application level (HTTP 400/409) or could not be delivered (502)."""

    def __init__(self, code: str, detail: str, status_code: int = 400):
        super().__init__(detail)
        self.code = code
        self.detail = detail
        self.status_code = status_code


def register_device(**fields) -> Device:
    """Create a device together with its permanent default unit (unitId 0)."""
    device = Device.objects.create(**fields)
    DeviceUnit.objects.create(
        device=device,
        unit_id=DEFAULT_UNIT_ID,
        is_default=True,
        has_setup=False,
        trig_pin=DEFAULT_PINS["trig"],
        echo_pin=DEFAULT_PINS["echo"],
        servo_pin=DEFAULT_PINS["servo"],
    )
    return device


def _general_payload(device: Device) -> dict:
    return {
        "tolerant_distance_cm": device.tolerant_distance_cm,
        "timeout_seconds": device.timeout_seconds,
        "longitude": device.longitude,
        "latitude": device.latitude,
    }


def _publish(device: Device, topic_suffix: str, payload: dict) -> None:
    try:
        mqtt_service.publish_command(device.device_id, *topic_suffix.split("/"), payload=payload)
    except mqtt_service.MqttPublishError as exc:
        raise DeviceCommandError("mqtt_unavailable", str(exc), status_code=502) from exc


def _validate_pin(pin: int, role: str, needs_output: bool) -> None:
    if pin in UART0_PINS:
        raise DeviceCommandError("reserved_pin", f"{role}: GPIO{pin} dipakai UART0 (Serial Monitor).")
    if pin in FLASH_PINS or pin in NONEXISTENT_PINS or not 0 <= pin <= MAX_GPIO:
        raise DeviceCommandError("invalid_pin", f"{role}: GPIO{pin} tidak valid di ESP32.")
    if needs_output and pin in INPUT_ONLY_PINS:
        raise DeviceCommandError("invalid_pin", f"{role}: GPIO{pin} hanya input, tidak bisa dipakai sebagai output.")


def validate_new_unit(device: Device, trig_pin: int, echo_pin: int, servo_pin: int) -> None:
    if device.units.count() >= MAX_UNITS:
        raise DeviceCommandError(
            "max_units_reached", f"Maksimal {MAX_UNITS} unit (termasuk default).", status_code=409
        )

    requested = (("TRIG", trig_pin, True), ("ECHO", echo_pin, False), ("SERVO", servo_pin, True))
    for role, pin, needs_output in requested:
        _validate_pin(pin, role, needs_output)

    if len({trig_pin, echo_pin, servo_pin}) < 3:
        raise DeviceCommandError("pin_conflict_request", "TRIG, ECHO, dan SERVO harus memakai GPIO berbeda.")

    for unit in device.units.all():
        used = {unit.trig_pin: "TRIG", unit.echo_pin: "ECHO", unit.servo_pin: "SERVO"}
        for role, pin, _ in requested:
            if pin in used:
                raise DeviceCommandError(
                    "pin_conflict_active",
                    f"{role}: GPIO{pin} sedang dipakai unit {unit.unit_id} ({used[pin]}).",
                    status_code=409,
                )


def request_add_unit(device: Device, trig_pin: int, echo_pin: int, servo_pin: int) -> dict:
    """Publish config/set. Returns the payload that was sent."""
    validate_new_unit(device, trig_pin, echo_pin, servo_pin)
    payload = {
        "sensor": {"type": "ultrasonic", "trig_pin": trig_pin, "echo_pin": echo_pin},
        "servo": {"pin": servo_pin},
        **_general_payload(device),
    }
    _publish(device, "config/set", payload)
    return payload


def request_unset_units(device: Device, unit_ids: Iterable[int]) -> dict:
    """Publish config/unset. unitId 0 is permanent and never leaves this function as a command."""
    ids = sorted(set(unit_ids))
    if not ids:
        raise DeviceCommandError("no_unit_id", "Pilih minimal satu unit.")
    if DEFAULT_UNIT_ID in ids:
        raise DeviceCommandError("cannot_unset_default", "Unit 0 adalah unit default dan tidak bisa dihapus.")

    known = set(device.units.values_list("unit_id", flat=True))
    unknown = [i for i in ids if i not in known]
    if unknown:
        raise DeviceCommandError(
            "unit_not_found", f"Unit tidak ditemukan: {', '.join(map(str, unknown))}.", status_code=404
        )

    payload = {"unitId": ids[0] if len(ids) == 1 else ids}
    _publish(device, "config/unset", payload)
    return payload


def push_general_config(device: Device) -> dict:
    """Publish config/general with the parameters currently stored for the device."""
    payload = _general_payload(device)
    _publish(device, "config/general", payload)
    return payload
