"""MQTT integration layer.

The firmware latches an alarm once an object is confirmed: the buzzer sounds and alerts repeat until a
`release` message (published by DeviceService.release_alarm) arrives. Units report `isObjectDetected` /
`buzzerActive` in telemetry and config/status; a unit going from latched back to released stamps
`released_at` on its open alerts.

Two roles share one class:
  * worker    (`manage.py run_mqtt`): subscribes to device topics and writes to MySQL.
  * publisher (inside the web process): publish-only, used by DeviceService.

paho runs its network loop on its own thread (`loop_start`); `publish` is thread-safe.
ESP32 `timestamp` is `millis()` since boot, not wall-clock time, so all rows are
stamped with server time.
"""
from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import timedelta
from typing import Any, Callable, Mapping

import paho.mqtt.client as mqtt
from django.conf import settings
from django.db import close_old_connections, transaction
from django.db.models import F
from django.utils import timezone

from core.models import (
    AlertLog,
    DetectionState,
    Device,
    DeviceUnit,
    SensorStatus,
    TelemetryLog,
    UnitSource,
)

logger = logging.getLogger(__name__)

SUBSCRIPTIONS = ("iot/+/telemetry", "iot/+/alert", "iot/+/config/status")
# Firmware repeats alerts every 60 s; 3 min tolerates a missed beat before a new row is opened.
ALERT_MERGE_WINDOW = timedelta(seconds=180)

Payload = Mapping[str, Any]


class MqttUnavailableError(RuntimeError):
    """Broker unreachable or publish not acknowledged."""


# --------------------------------------------------------------------------- parsing helpers
def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_choice(value: Any, choices: type, default: str) -> str:
    return value if value in choices.values else default


def _as_bool(value: Any) -> bool:
    return value is True


def _previous_alarm(device: Device, unit_id: int) -> bool:
    return bool(
        DeviceUnit.objects.filter(device=device, unit_id=unit_id).values_list("is_object_detected", flat=True).first()
    )


def _track_alarm(device: Device, unit_id: int, was_detected: bool, is_detected: bool, now) -> None:
    """Latched -> released on the device: open alerts stop absorbing repeats."""
    if was_detected and not is_detected:
        logger.info("Alarm released on %s unit %s", device.device_id, unit_id)
        AlertLog.objects.filter(
            device=device, unit_id=unit_id, is_resolved=False, released_at__isnull=True
        ).update(released_at=now)


# --------------------------------------------------------------------------- ingest handlers
def ingest_telemetry(device: Device, payload: Payload) -> None:
    unit_id = _as_int(payload.get("unitId"))
    if unit_id is None:
        raise ValueError("telemetry: unitId missing")

    now = timezone.now()
    state = _as_choice(payload.get("detectionState"), DetectionState, DetectionState.SCANNING)
    sensor = _as_choice(payload.get("sensorStatus"), SensorStatus, SensorStatus.OBJECT_NOT_DETECTED)
    distance = _as_float(payload.get("distanceCm"))
    servo = _as_int(payload.get("servoPosition"))
    is_default = payload.get("source") == UnitSource.DEFAULT

    is_detected = _as_bool(payload.get("isObjectDetected"))
    defaults: dict[str, Any] = {
        "is_default": is_default or unit_id == 0,
        "has_setup": bool(payload.get("hasSetup", False)),
        "detection_state": state,
        "sensor_status": sensor,
        "is_object_detected": is_detected,
        "buzzer_active": _as_bool(payload.get("buzzerActive")),
        "last_distance_cm": distance,
        "servo_position": servo,
        "last_seen_at": now,
    }
    buzzer_pin = _as_int(payload.get("buzzerPin"))
    if buzzer_pin is not None:  # older firmware does not report it
        defaults["buzzer_pin"] = buzzer_pin

    with transaction.atomic():
        was_detected = _previous_alarm(device, unit_id)
        TelemetryLog.objects.create(
            device=device,
            unit_id=unit_id,
            distance_cm=distance,
            servo_position=servo,
            detection_state=state,
            sensor_status=sensor,
            created_at=now,
        )
        DeviceUnit.objects.update_or_create(device=device, unit_id=unit_id, defaults=defaults)
        _track_alarm(device, unit_id, was_detected, is_detected, now)
        Device.objects.filter(pk=device.pk).update(last_seen_at=now)


def ingest_alert(device: Device, payload: Payload) -> None:
    unit_id = _as_int(payload.get("unitId"))
    if unit_id is None:
        raise ValueError("alert: unitId missing")

    now = timezone.now()
    event_name = str(payload.get("eventName", "object_detected"))[:64]
    distance = _as_float(payload.get("distanceCm"))
    location = payload.get("location") if isinstance(payload.get("location"), dict) else {}
    latitude = _as_float(location.get("latitude"))
    longitude = _as_float(location.get("longitude"))

    with transaction.atomic():
        open_alert = (
            AlertLog.objects.select_for_update()
            .filter(
                device=device,
                unit_id=unit_id,
                event_name=event_name,
                is_resolved=False,
                released_at__isnull=True,  # a released alarm is over; a new alert is a new incident
                updated_at__gte=now - ALERT_MERGE_WINDOW,
            )
            .order_by("-updated_at")
            .first()
        )
        if open_alert is not None:
            open_alert.repeat_count = F("repeat_count") + 1
            open_alert.distance_cm = distance
            open_alert.save(update_fields=["repeat_count", "distance_cm", "updated_at"])
        else:
            AlertLog.objects.create(
                device=device,
                unit_id=unit_id,
                event_name=event_name,
                alert_type=str(payload.get("alertType", "warning"))[:32],
                message=str(payload.get("alertMessage", ""))[:255],
                distance_cm=distance,
                latitude=latitude if latitude is not None else device.latitude,
                longitude=longitude if longitude is not None else device.longitude,
                created_at=now,
            )
        Device.objects.filter(pk=device.pk).update(last_seen_at=now)


def ingest_config_status(device: Device, payload: Payload) -> None:
    """Reconcile DB with what the firmware says it has. The firmware is the source of
    truth for unit slots: a unit absent from `units` has been removed."""
    now = timezone.now()
    detail = str(payload.get("detail", "")).strip()
    hint = str(payload.get("hint", "")).strip()
    full_detail = f"{detail} ({hint})" if detail and hint else detail or hint

    fields: dict[str, Any] = {
        "last_seen_at": now,
        "last_operation": str(payload.get("lastOperation", ""))[:16],
        "last_config_result": str(payload.get("setupResult", ""))[:40],
        "last_config_detail": full_detail,
        "last_config_at": now,
    }
    tolerant = _as_float(payload.get("tolerantDistanceCm"))
    timeout = _as_int(payload.get("timeoutSeconds"))
    if tolerant is not None:
        fields["tolerant_distance_cm"] = tolerant
    if timeout is not None:
        fields["timeout_seconds"] = timeout

    units = payload.get("units")
    with transaction.atomic():
        Device.objects.filter(pk=device.pk).update(**fields)
        if not isinstance(units, list):
            return

        reported: set[int] = set()
        for item in units:
            if not isinstance(item, dict):
                continue
            unit_id = _as_int(item.get("unitId"))
            if unit_id is None:
                continue
            reported.add(unit_id)
            pins = item.get("pins") if isinstance(item.get("pins"), dict) else {}
            was_detected = _previous_alarm(device, unit_id)
            is_detected = _as_bool(item.get("isObjectDetected"))
            DeviceUnit.objects.update_or_create(
                device=device,
                unit_id=unit_id,
                defaults={
                    "is_default": item.get("source") == UnitSource.DEFAULT or unit_id == 0,
                    "has_setup": bool(item.get("hasSetup", False)),
                    "is_object_detected": is_detected,
                    "buzzer_active": _as_bool(item.get("buzzerActive")),
                    "trig_pin": _as_int(pins.get("trig")),
                    "echo_pin": _as_int(pins.get("echo")),
                    "servo_pin": _as_int(pins.get("servo")),
                    "buzzer_pin": _as_int(pins.get("buzzer")),
                    "detection_state": _as_choice(
                        item.get("detectionState"), DetectionState, DetectionState.SCANNING
                    ),
                },
            )
            _track_alarm(device, unit_id, was_detected, is_detected, now)
        device.units.exclude(unit_id__in=reported).delete()


HANDLERS: dict[str, Callable[[Device, Payload], None]] = {
    "telemetry": ingest_telemetry,
    "alert": ingest_alert,
    "config/status": ingest_config_status,
}


def parse_topic(topic: str) -> tuple[str, str] | None:
    """'iot/<device_id>/<channel>' -> (device_id, channel); None if not a handled topic."""
    parts = topic.split("/", 2)
    if len(parts) != 3 or parts[0] != "iot" or parts[2] not in HANDLERS:
        return None
    return parts[1], parts[2]


# --------------------------------------------------------------------------- client
class MqttService:
    def __init__(self, *, subscribe: bool, role: str) -> None:
        self._subscribe = subscribe
        self._connected = threading.Event()
        self._client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"slop-{role}-{uuid.uuid4().hex[:8]}",
        )
        if settings.MQTT_USERNAME:
            self._client.username_pw_set(settings.MQTT_USERNAME, settings.MQTT_PASSWORD)
        self._client.reconnect_delay_set(min_delay=1, max_delay=30)
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message

    # lifecycle ---------------------------------------------------------------
    def start(self) -> None:
        """Non-blocking: paho reconnects with backoff on its own thread."""
        self._client.connect_async(settings.MQTT_HOST, settings.MQTT_PORT, keepalive=60)
        self._client.loop_start()

    def stop(self) -> None:
        self._client.disconnect()
        self._client.loop_stop()

    # publishing --------------------------------------------------------------
    def publish(self, topic: str, payload: Payload, *, qos: int = 1, timeout: float = 3.0) -> None:
        if not self._connected.wait(timeout):
            raise MqttUnavailableError("Broker MQTT tidak terhubung.")
        info = self._client.publish(topic, json.dumps(payload, separators=(",", ":")), qos=qos)
        try:
            info.wait_for_publish(timeout=timeout)
        except (ValueError, RuntimeError) as exc:
            raise MqttUnavailableError(f"Gagal mengirim ke broker: {exc}") from exc
        if not info.is_published():
            raise MqttUnavailableError("Broker tidak mengonfirmasi pesan tepat waktu.")

    # callbacks (paho network thread) ---------------------------------------------
    def _on_connect(self, client, userdata, flags, reason_code, properties) -> None:
        if reason_code.is_failure:
            logger.error("MQTT connect refused: %s", reason_code)
            return
        logger.info("MQTT connected to %s:%s", settings.MQTT_HOST, settings.MQTT_PORT)
        self._connected.set()
        if self._subscribe:  # re-subscribe on every reconnect (clean session)
            client.subscribe([(topic, 1) for topic in SUBSCRIPTIONS])

    def _on_disconnect(self, client, userdata, disconnect_flags, reason_code, properties) -> None:
        self._connected.clear()
        logger.warning("MQTT disconnected: %s", reason_code)

    def _on_message(self, client, userdata, msg: mqtt.MQTTMessage) -> None:
        parsed = parse_topic(msg.topic)
        if parsed is None:
            return
        device_id, channel = parsed
        close_old_connections()  # this thread outlives Django's request cycle
        try:
            payload = json.loads(msg.payload)
            if not isinstance(payload, dict):
                raise ValueError("payload must be a JSON object")
            device = Device.objects.filter(device_id=device_id).first()
            if device is None:
                logger.warning("Ignoring %s: device %s is not registered", channel, device_id)
                return
            HANDLERS[channel](device, payload)
        except (ValueError, TypeError) as exc:  # includes JSONDecodeError
            logger.warning("Bad %s payload from %s: %s", channel, device_id, exc)
        except Exception:
            logger.exception("Failed handling %s from %s", channel, device_id)
        finally:
            close_old_connections()


_publisher: MqttService | None = None
_publisher_lock = threading.Lock()


def get_mqtt_publisher() -> MqttService:
    """Lazily started, publish-only client shared by the web process."""
    global _publisher
    with _publisher_lock:
        if _publisher is None:
            service = MqttService(subscribe=False, role="publisher")
            service.start()
            _publisher = service
        return _publisher
