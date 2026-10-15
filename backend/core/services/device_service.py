"""Device business logic: validates commands and publishes them over MQTT.

Mirrors the ESP32 firmware rules so mistakes are caught before a round trip, but the
firmware stays authoritative: its verdict arrives on config/status and is stored on
the Device (last_config_result / last_config_detail).

The firmware, not this service, picks the unitId of a new unit (smallest free slot),
so `add_unit` returns nothing about the id; the unit shows up after config/status.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from core.models import Device
from core.services.mqtt_service import get_mqtt_publisher

MAX_UNITS = 4  # unit 0 (default) + 3 dynamic
GPIO_RANGE = range(0, 40)
RESERVED_GPIO = frozenset({1, 3})  # UART0
TOLERANT_DISTANCE_RANGE_CM = (0.1, 400.0)
TIMEOUT_RANGE_SECONDS = (1, 86400)


class Publisher(Protocol):
    def publish(self, topic: str, payload: dict[str, Any]) -> None: ...


class DeviceCommandError(Exception):
    """A command rejected by application-level validation."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class GeneralParams:
    tolerant_distance_cm: float | None = None
    timeout_seconds: int | None = None
    latitude: float | None = None
    longitude: float | None = None

    def is_empty(self) -> bool:
        return all(value is None for value in vars(self).values())


@dataclass(frozen=True)
class AddUnitCommand:
    trig_pin: int
    echo_pin: int
    servo_pin: int
    buzzer_pin: int
    params: GeneralParams = GeneralParams()


@dataclass(frozen=True)
class PublishedCommand:
    topic: str
    payload: dict[str, Any]


def _validate_general(params: GeneralParams) -> None:
    low, high = TOLERANT_DISTANCE_RANGE_CM
    if params.tolerant_distance_cm is not None and not low <= params.tolerant_distance_cm <= high:
        raise DeviceCommandError("invalid_tolerant_distance", f"Jarak toleransi harus {low}–{high} cm.")
    low_s, high_s = TIMEOUT_RANGE_SECONDS
    if params.timeout_seconds is not None and not low_s <= params.timeout_seconds <= high_s:
        raise DeviceCommandError("invalid_timeout", f"Timeout harus {low_s}–{high_s} detik.")
    if params.latitude is not None and not -90 <= params.latitude <= 90:
        raise DeviceCommandError("invalid_latitude", "Latitude harus -90 sampai 90.")
    if params.longitude is not None and not -180 <= params.longitude <= 180:
        raise DeviceCommandError("invalid_longitude", "Longitude harus -180 sampai 180.")


def _general_payload(params: GeneralParams) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if params.tolerant_distance_cm is not None:
        payload["tolerant_distance_cm"] = params.tolerant_distance_cm
    if params.timeout_seconds is not None:
        payload["timeout_seconds"] = params.timeout_seconds
    if params.latitude is not None:
        payload["latitude"] = params.latitude
    if params.longitude is not None:
        payload["longitude"] = params.longitude
    return payload


class DeviceService:
    def __init__(self, publisher: Publisher | None = None) -> None:
        self._publisher = publisher

    # config/set ---------------------------------------------------------------------
    def add_unit(self, device: Device, command: AddUnitCommand) -> PublishedCommand:
        self._validate_add_unit(device, command)
        payload: dict[str, Any] = {
            "sensor": {"trig_pin": command.trig_pin, "echo_pin": command.echo_pin},
            "servo": {"pin": command.servo_pin},
            "buzzer": {"pin": command.buzzer_pin},
            **_general_payload(command.params),
        }
        return self._publish(device, "config/set", payload)

    def _validate_add_unit(self, device: Device, command: AddUnitCommand) -> None:
        if device.units.count() >= MAX_UNITS:
            raise DeviceCommandError("max_units_reached", f"Maksimal {MAX_UNITS} unit (termasuk default).")

        roles = {
            "ultrasonic_trig": command.trig_pin,
            "ultrasonic_echo": command.echo_pin,
            "servo_pwm": command.servo_pin,
            "buzzer": command.buzzer_pin,
        }
        for role, pin in roles.items():
            if pin not in GPIO_RANGE:
                raise DeviceCommandError("invalid_pin", f"{role}: GPIO{pin} di luar rentang 0–39.")
            if pin in RESERVED_GPIO:
                raise DeviceCommandError("reserved_pin", f"{role}: GPIO{pin} dipakai UART0 (Serial Monitor).")
        if len(set(roles.values())) != len(roles):
            raise DeviceCommandError("pin_duplicate", "Pin trig, echo, servo, dan buzzer harus berbeda.")

        in_use: dict[int, str] = {}
        for unit in device.units.all():
            for pin in (unit.trig_pin, unit.echo_pin, unit.servo_pin, unit.buzzer_pin):
                if pin is not None:
                    in_use[pin] = f"unit {unit.unit_id}"
        for role, pin in roles.items():
            if pin in in_use:
                raise DeviceCommandError(
                    "pin_conflict_active", f"{role}: GPIO{pin} sedang dipakai {in_use[pin]}."
                )
        _validate_general(command.params)

    # config/unset -------------------------------------------------------------------
    def remove_units(self, device: Device, unit_ids: list[int]) -> PublishedCommand:
        if not unit_ids:
            raise DeviceCommandError("no_unit_id", "Pilih minimal satu unit.")
        if 0 in unit_ids:
            raise DeviceCommandError("cannot_unset_default", "Unit 0 adalah unit default dan tidak bisa dihapus.")
        known = set(device.units.values_list("unit_id", flat=True))
        missing = sorted(set(unit_ids) - known)
        if missing:
            raise DeviceCommandError("unit_not_found", f"Unit tidak ditemukan: {', '.join(map(str, missing))}.")

        unique_ids = sorted(set(unit_ids))
        payload = {"unitId": unique_ids[0] if len(unique_ids) == 1 else unique_ids}
        return self._publish(device, "config/unset", payload)

    # release ------------------------------------------------------------------------
    def release_alarm(self, device: Device, unit_ids: list[int] | None = None) -> PublishedCommand:
        """Stop alert repeats and silence the buzzer of latched units.

        No `unit_ids` -> empty payload: the firmware releases every unit in alarm. The firmware
        answers on config/status (release_ok / no_active_alert / unit_not_found); the alarm flags on
        DeviceUnit only change once it confirms.
        """
        if unit_ids is None:
            return self._publish(device, "release", {})
        if not unit_ids:
            raise DeviceCommandError("no_unit_id", "Pilih minimal satu unit.")
        known = set(device.units.values_list("unit_id", flat=True))
        missing = sorted(set(unit_ids) - known)
        if missing:
            raise DeviceCommandError("unit_not_found", f"Unit tidak ditemukan: {', '.join(map(str, missing))}.")
        unique_ids = sorted(set(unit_ids))
        return self._publish(device, "release", {"unitId": unique_ids[0] if len(unique_ids) == 1 else unique_ids})

    # config/general -----------------------------------------------------------------
    def update_general(self, device: Device, params: GeneralParams) -> PublishedCommand:
        if params.is_empty():
            raise DeviceCommandError("empty_params", "Isi minimal satu parameter.")
        _validate_general(params)
        command = self._publish(device, "config/general", _general_payload(params))

        # The firmware does NOT publish config/status after config/general, so persist
        # the new values now; a later config/status will overwrite them with the truth.
        for field, value in vars(params).items():
            if value is not None:
                setattr(device, field, value)
        device.save(update_fields=[f for f, v in vars(params).items() if v is not None])
        return command

    # --------------------------------------------------------------------------------
    def _publish(self, device: Device, channel: str, payload: dict[str, Any]) -> PublishedCommand:
        topic = f"iot/{device.device_id}/{channel}"
        publisher = self._publisher or get_mqtt_publisher()
        publisher.publish(topic, payload)
        return PublishedCommand(topic=topic, payload=payload)
