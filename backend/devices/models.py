"""Persistence layer. The database mirrors what the ESP32 firmware reports; it never invents device state."""
from datetime import timedelta

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models
from django.utils import timezone

# MQTT topics embed the device id, so it must not contain topic separators or wildcards (/ + #).
device_id_validator = RegexValidator(
    r"^[A-Za-z0-9_-]{1,64}$", "Device ID hanya boleh huruf, angka, '-' dan '_' (maks. 64 karakter)."
)


class Device(models.Model):
    """One ESP32 board. Operator-managed parameters live here; unit/pin state is reported by the board."""

    device_id = models.CharField(max_length=64, unique=True, validators=[device_id_validator])
    name = models.CharField(max_length=120)
    latitude = models.FloatField(validators=[MinValueValidator(-90), MaxValueValidator(90)])
    longitude = models.FloatField(validators=[MinValueValidator(-180), MaxValueValidator(180)])
    tolerant_distance_cm = models.FloatField(
        default=10.0, validators=[MinValueValidator(0.1), MaxValueValidator(400.0)]
    )
    timeout_seconds = models.PositiveIntegerField(
        default=300, validators=[MinValueValidator(1), MaxValueValidator(86400)]
    )

    last_seen = models.DateTimeField(null=True, blank=True)
    # Outcome of the last config/set|unset reported on iot/<id>/config/status.
    last_operation = models.CharField(max_length=20, blank=True)
    setup_result = models.CharField(max_length=40, blank=True)
    setup_detail = models.TextField(blank=True)
    setup_reported_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.device_id})"

    @property
    def is_online(self) -> bool:
        if self.last_seen is None:
            return False
        window = timedelta(seconds=settings.DEVICE_ONLINE_WINDOW_SECONDS)
        return timezone.now() - self.last_seen <= window


class DeviceUnit(models.Model):
    """A sensor + servo pair. unit_id 0 is the permanent default unit built into the firmware."""

    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="units")
    unit_id = models.PositiveSmallIntegerField()
    trig_pin = models.PositiveSmallIntegerField(null=True, blank=True)
    echo_pin = models.PositiveSmallIntegerField(null=True, blank=True)
    servo_pin = models.PositiveSmallIntegerField(null=True, blank=True)
    is_default = models.BooleanField(default=False)
    has_setup = models.BooleanField(default=False)

    detection_state = models.CharField(max_length=20, blank=True)  # scanning | tracking | confirmed
    last_distance_cm = models.FloatField(null=True, blank=True)
    servo_position = models.IntegerField(null=True, blank=True)
    last_seen = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["unit_id"]
        constraints = [models.UniqueConstraint(fields=["device", "unit_id"], name="uniq_unit_per_device")]

    def __str__(self):
        return f"{self.device.device_id}/unit{self.unit_id}"


class TelemetryLog(models.Model):
    """Append-only sensor readings (one row per unit every ~5 s). Plan a retention job for production."""

    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="telemetry")
    unit_id = models.PositiveSmallIntegerField()
    distance_cm = models.FloatField(null=True, blank=True)  # null when no echo (object_not_detected)
    servo_position = models.IntegerField(null=True, blank=True)
    detection_state = models.CharField(max_length=20, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["device", "-created_at"])]


class AlertLog(models.Model):
    """A confirmed violation. The firmware repeats alerts every 60 s; repeats merge into one open row."""

    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="alerts")
    unit_id = models.PositiveSmallIntegerField()
    event_name = models.CharField(max_length=60)
    alert_type = models.CharField(max_length=30)
    message = models.CharField(max_length=255)
    distance_cm = models.FloatField(null=True, blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)

    occurrences = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(default=timezone.now)
    last_occurred_at = models.DateTimeField(default=timezone.now)

    is_resolved = models.BooleanField(default=False)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-last_occurred_at"]
        indexes = [models.Index(fields=["is_resolved", "-last_occurred_at"])]
