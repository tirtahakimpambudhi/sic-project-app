"""MQTT integration layer (paho-mqtt 2.x).

Two roles, both running paho's network loop on its own thread (`loop_start`):

* ``MqttPublisher``  - used by the API process to send commands to devices.
* ``MqttListener``   - used by the ``run_mqtt`` worker; subscribes to the iot/+/... wildcards and
  persists everything the ESP32 reports through the Django ORM.

Topic contract (prefix ``iot/<DEVICE_ID>/``):
    publish   -> config/set, config/unset, config/general, release
    subscribe <- telemetry, alert, config/status

The firmware latches an alarm once an object is confirmed: the buzzer sounds and alerts repeat until a
``release`` message arrives. Units report ``isObjectDetected`` / ``buzzerActive`` in telemetry and
config/status; a unit going from latched back to released stamps ``released_at`` on its open alerts.
"""
import json
import logging
import threading
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import close_old_connections, transaction
from django.utils import timezone

import paho.mqtt.client as mqtt

logger = logging.getLogger(__name__)

TOPIC_PREFIX = "iot"
SUBSCRIPTIONS = (f"{TOPIC_PREFIX}/+/telemetry", f"{TOPIC_PREFIX}/+/alert", f"{TOPIC_PREFIX}/+/config/status")
CONNECT_TIMEOUT_SECONDS = 5
PUBLISH_TIMEOUT_SECONDS = 5


class MqttPublishError(Exception):
    """The broker is unreachable or did not acknowledge the message."""


def build_topic(device_id: str, *suffix: str) -> str:
    return "/".join((TOPIC_PREFIX, device_id, *suffix))


class _MqttConnection:
    """Shared connection plumbing: credentials, auto-reconnect and a background network thread."""

    def __init__(self, client_id_prefix: str):
        self._connected = threading.Event()
        self._client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"{client_id_prefix}-{uuid.uuid4().hex[:8]}",
        )
        self._client.username_pw_set(settings.MQTT_USERNAME, settings.MQTT_PASSWORD)
        self._client.reconnect_delay_set(min_delay=1, max_delay=30)
        self._client.on_connect = self._handle_connect
        self._client.on_disconnect = self._handle_disconnect

    def start(self) -> None:
        self._client.connect_async(
            settings.MQTT_BROKER_HOST, settings.MQTT_BROKER_PORT, keepalive=settings.MQTT_KEEPALIVE_SECONDS
        )
        self._client.loop_start()

    def stop(self) -> None:
        self._client.loop_stop()
        self._client.disconnect()

    def wait_until_connected(self, timeout: float = CONNECT_TIMEOUT_SECONDS) -> bool:
        return self._connected.wait(timeout)

    # paho callbacks run on the network thread.
    def _handle_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            logger.error("MQTT connect refused: %s", reason_code)
            return
        logger.info("MQTT connected to %s:%s", settings.MQTT_BROKER_HOST, settings.MQTT_BROKER_PORT)
        self._connected.set()
        self._on_connected(client)

    def _handle_disconnect(self, client, userdata, disconnect_flags, reason_code, properties):
        self._connected.clear()
        logger.warning("MQTT disconnected (%s); paho will retry", reason_code)

    def _on_connected(self, client) -> None:  # hook for subclasses
        pass


class MqttPublisher(_MqttConnection):
    def __init__(self):
        super().__init__("slop-api")

    def publish_json(self, topic: str, payload: dict, qos: int = 1) -> None:
        if not self.wait_until_connected():
            raise MqttPublishError("MQTT broker tidak dapat dihubungi.")
        info = self._client.publish(topic, json.dumps(payload), qos=qos)
        info.wait_for_publish(PUBLISH_TIMEOUT_SECONDS)
        if not info.is_published():
            raise MqttPublishError("Broker tidak mengonfirmasi pesan.")
        logger.info("MQTT publish %s: %s", topic, payload)


_publisher = None
_publisher_lock = threading.Lock()


def get_publisher() -> MqttPublisher:
    """Process-wide publisher, created lazily so every gunicorn worker owns exactly one connection."""
    global _publisher
    with _publisher_lock:
        if _publisher is None:
            publisher = MqttPublisher()
            publisher.start()
            _publisher = publisher
        return _publisher


def publish_command(device_id: str, *topic_suffix: str, payload: dict) -> None:
    get_publisher().publish_json(build_topic(device_id, *topic_suffix), payload)


# --------------------------------------------------------------------------------------
# Listener: ESP32 -> backend
# --------------------------------------------------------------------------------------
def _to_float(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _to_int(value):
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _to_bool(value) -> bool:
    return value is True


def _mark_alerts_released(device, unit_id: int, now) -> None:
    """The unit's alarm was released on the device: its open alerts stop absorbing repeats."""
    from devices.models import AlertLog

    AlertLog.objects.filter(device=device, unit_id=unit_id, is_resolved=False, released_at__isnull=True).update(
        released_at=now
    )


def _track_alarm(device, unit_id: int, was_detected: bool, is_detected: bool, now) -> None:
    if was_detected and not is_detected:
        logger.info("Alarm released on %s unit %s", device.device_id, unit_id)
        _mark_alerts_released(device, unit_id, now)


class MqttListener(_MqttConnection):
    def __init__(self):
        super().__init__("slop-worker")
        self._client.on_message = self._handle_message
        self._handlers = {
            "telemetry": self._handle_telemetry,
            "alert": self._handle_alert,
            "config/status": self._handle_config_status,
        }

    def _on_connected(self, client) -> None:
        # (Re)subscribe on every connect: brokers drop subscriptions of clean sessions.
        for topic in SUBSCRIPTIONS:
            client.subscribe(topic, qos=1)
            logger.info("MQTT subscribed to %s", topic)

    def _handle_message(self, client, userdata, msg):
        """Runs on paho's thread: one DB connection lifecycle per message, never raise."""
        close_old_connections()
        try:
            parts = msg.topic.split("/")
            if len(parts) < 3 or parts[0] != TOPIC_PREFIX:
                return
            device_id, kind = parts[1], "/".join(parts[2:])
            handler = self._handlers.get(kind)
            if handler is None:
                return
            data = json.loads(msg.payload.decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError("payload must be a JSON object")

            from devices.models import Device

            device = Device.objects.filter(device_id=device_id).first()
            if device is None:
                logger.warning("Ignoring %s from unregistered device %s", kind, device_id)
                return
            with transaction.atomic():
                handler(device, data)
        except Exception:  # noqa: BLE001 - a bad message must never kill the network thread
            logger.exception("Failed to process %s: %r", msg.topic, msg.payload[:200])
        finally:
            close_old_connections()

    # ---- handlers --------------------------------------------------------------------
    def _touch_device(self, device, now) -> None:
        device.last_seen = now
        device.save(update_fields=["last_seen"])

    def _handle_telemetry(self, device, data):
        from devices.models import DeviceUnit, TelemetryLog

        unit_id = _to_int(data.get("unitId"))
        if unit_id is None:
            raise ValueError("telemetry without unitId")
        now = timezone.now()
        detected = data.get("sensorStatus") == "object_detected"
        distance = _to_float(data.get("distanceCm")) if detected else None
        servo_position = _to_int(data.get("servoPosition"))
        state = str(data.get("detectionState", ""))

        was_detected = bool(
            DeviceUnit.objects.filter(device=device, unit_id=unit_id).values_list("is_object_detected", flat=True).first()
        )
        is_detected = _to_bool(data.get("isObjectDetected"))
        defaults = {
            "is_default": data.get("source") == "default",
            "has_setup": bool(data.get("hasSetup", False)),
            "detection_state": state,
            "is_object_detected": is_detected,
            "buzzer_active": _to_bool(data.get("buzzerActive")),
            "last_distance_cm": distance,
            "servo_position": servo_position,
            "last_seen": now,
        }
        buzzer_pin = _to_int(data.get("buzzerPin"))
        if buzzer_pin is not None:  # older firmware does not report it
            defaults["buzzer_pin"] = buzzer_pin
        DeviceUnit.objects.update_or_create(device=device, unit_id=unit_id, defaults=defaults)
        _track_alarm(device, unit_id, was_detected, is_detected, now)
        TelemetryLog.objects.create(
            device=device,
            unit_id=unit_id,
            distance_cm=distance,
            servo_position=servo_position,
            detection_state=state,
            created_at=now,
        )
        self._touch_device(device, now)

    def _handle_alert(self, device, data):
        from devices.models import AlertLog

        unit_id = _to_int(data.get("unitId"))
        if unit_id is None:
            raise ValueError("alert without unitId")
        now = timezone.now()
        location = data.get("location") if isinstance(data.get("location"), dict) else {}
        distance = _to_float(data.get("distanceCm"))
        latitude = _to_float(location.get("latitude"))
        longitude = _to_float(location.get("longitude"))

        merge_after = now - timedelta(seconds=settings.ALERT_MERGE_WINDOW_SECONDS)
        open_alert = (
            AlertLog.objects.select_for_update()
            .filter(
                device=device,
                unit_id=unit_id,
                is_resolved=False,
                released_at__isnull=True,  # a released alarm is over; a new alert is a new incident
                last_occurred_at__gte=merge_after,
            )
            .first()
        )
        if open_alert:
            open_alert.occurrences += 1
            open_alert.last_occurred_at = now
            open_alert.distance_cm = distance if distance is not None else open_alert.distance_cm
            open_alert.save(update_fields=["occurrences", "last_occurred_at", "distance_cm"])
        else:
            AlertLog.objects.create(
                device=device,
                unit_id=unit_id,
                event_name=str(data.get("eventName", "object_detected")),
                alert_type=str(data.get("alertType", "warning")),
                message=str(data.get("alertMessage", ""))[:255],
                distance_cm=distance,
                latitude=latitude if latitude is not None else device.latitude,
                longitude=longitude if longitude is not None else device.longitude,
                created_at=now,
                last_occurred_at=now,
            )
        self._touch_device(device, now)

    def _handle_config_status(self, device, data):
        """Reconcile DB units with the board's own report - the board is the source of truth for pins."""
        from devices.models import DeviceUnit

        now = timezone.now()
        device.last_seen = now
        device.last_operation = str(data.get("lastOperation", ""))[:20]
        device.setup_result = str(data.get("setupResult", ""))[:40]
        device.setup_detail = str(data.get("detail", ""))
        device.setup_reported_at = now
        device.save(update_fields=["last_seen", "last_operation", "setup_result", "setup_detail", "setup_reported_at"])

        reported_ids = []
        for item in data.get("units") or []:
            unit_id = _to_int(item.get("unitId"))
            if unit_id is None:
                continue
            pins = item.get("pins") if isinstance(item.get("pins"), dict) else {}
            reported_ids.append(unit_id)
            was_detected = bool(
                DeviceUnit.objects.filter(device=device, unit_id=unit_id)
                .values_list("is_object_detected", flat=True)
                .first()
            )
            is_detected = _to_bool(item.get("isObjectDetected"))
            DeviceUnit.objects.update_or_create(
                device=device,
                unit_id=unit_id,
                defaults={
                    "is_default": item.get("source") == "default",
                    "has_setup": bool(item.get("hasSetup", False)),
                    "detection_state": str(item.get("detectionState", "")),
                    "is_object_detected": is_detected,
                    "buzzer_active": _to_bool(item.get("buzzerActive")),
                    "trig_pin": _to_int(pins.get("trig")),
                    "echo_pin": _to_int(pins.get("echo")),
                    "servo_pin": _to_int(pins.get("servo")),
                    "buzzer_pin": _to_int(pins.get("buzzer")),
                },
            )
            _track_alarm(device, unit_id, was_detected, is_detected, now)
        if reported_ids:
            device.units.exclude(unit_id__in=reported_ids).delete()  # units removed via config/unset

        if device.last_operation == "boot":
            self._sync_parameters_after_boot(device, data)

    def _sync_parameters_after_boot(self, device, data):
        """A rebooted board runs firmware defaults; push the operator's saved parameters if they differ."""
        from devices.services import device_service

        reported_tolerance = _to_float(data.get("tolerantDistanceCm"))
        reported_timeout = _to_int(data.get("timeoutSeconds"))
        if reported_tolerance == device.tolerant_distance_cm and reported_timeout == device.timeout_seconds:
            return
        try:
            device_service.push_general_config(device)
        except Exception:  # noqa: BLE001
            logger.exception("Could not re-sync parameters for %s", device.device_id)
