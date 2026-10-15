"""Database schema for Slop."""
from datetime import timedelta

from django.contrib.auth.models import AbstractUser
from django.contrib.auth.models import UserManager as DjangoUserManager
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models
from django.utils import timezone

# Telemetry arrives every 5 s per unit; 3 missed beats = offline.
ONLINE_WINDOW = timedelta(seconds=20)


class UserRole(models.TextChoices):
    OPERATOR = "operator", "Operator"
    SATPOL_PP = "satpol_pp", "Satpol PP"


class DetectionState(models.TextChoices):
    SCANNING = "scanning", "Scanning"
    TRACKING = "tracking", "Tracking"
    CONFIRMED = "confirmed", "Confirmed"


class SensorStatus(models.TextChoices):
    OBJECT_DETECTED = "object_detected", "Object detected"
    OBJECT_NOT_DETECTED = "object_not_detected", "Object not detected"


class UnitSource(models.TextChoices):
    DEFAULT = "default", "Default"
    DYNAMIC = "dynamic", "Dynamic"


class UserManager(DjangoUserManager):
    def create_superuser(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault("role", UserRole.OPERATOR)
        return super().create_superuser(username, email, password, **extra_fields)


class User(AbstractUser):
    role = models.CharField(max_length=16, choices=UserRole.choices, default=UserRole.SATPOL_PP)

    objects = UserManager()

    @property
    def is_operator(self) -> bool:
        return self.role == UserRole.OPERATOR


class Device(models.Model):
    """One ESP32. `device_id` is the MQTT topic segment: iot/<device_id>/..."""

    device_id = models.CharField(
        max_length=64,
        unique=True,
        validators=[RegexValidator(r"^[A-Za-z0-9_-]+$", "Hanya huruf, angka, '-' dan '_'.")],
    )
    name = models.CharField(max_length=120)
    latitude = models.FloatField(default=0.0, validators=[MinValueValidator(-90), MaxValueValidator(90)])
    longitude = models.FloatField(default=0.0, validators=[MinValueValidator(-180), MaxValueValidator(180)])
    tolerant_distance_cm = models.FloatField(
        default=10.0, validators=[MinValueValidator(0.1), MaxValueValidator(400.0)]
    )
    timeout_seconds = models.PositiveIntegerField(
        default=300, validators=[MinValueValidator(1), MaxValueValidator(86400)]
    )

    last_seen_at = models.DateTimeField(null=True, blank=True)
    # Result of the last config operation, as reported by iot/<id>/config/status.
    last_operation = models.CharField(max_length=16, blank=True)
    last_config_result = models.CharField(max_length=40, blank=True)
    last_config_detail = models.TextField(blank=True)
    last_config_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.device_id})"

    @property
    def is_online(self) -> bool:
        return self.last_seen_at is not None and timezone.now() - self.last_seen_at <= ONLINE_WINDOW


class DeviceUnit(models.Model):
    """A sensor + servo + buzzer set. unit_id is the firmware slot (0 = permanent default, 1..3 dynamic)."""

    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="units")
    unit_id = models.PositiveSmallIntegerField(validators=[MaxValueValidator(3)])
    is_default = models.BooleanField(default=False)
    has_setup = models.BooleanField(default=False)

    # Nullable: unit 0 may report telemetry before the first config/status arrives.
    trig_pin = models.PositiveSmallIntegerField(null=True, blank=True)
    echo_pin = models.PositiveSmallIntegerField(null=True, blank=True)
    servo_pin = models.PositiveSmallIntegerField(null=True, blank=True)
    buzzer_pin = models.PositiveSmallIntegerField(null=True, blank=True)

    # Latest live reading, denormalised so the dashboard needs one query.
    detection_state = models.CharField(
        max_length=16, choices=DetectionState.choices, default=DetectionState.SCANNING
    )
    sensor_status = models.CharField(
        max_length=24, choices=SensorStatus.choices, default=SensorStatus.OBJECT_NOT_DETECTED
    )
    last_distance_cm = models.FloatField(null=True, blank=True)
    servo_position = models.PositiveSmallIntegerField(null=True, blank=True)
    # Latched alarm reported by the firmware: stays true after the object leaves, until a release.
    is_object_detected = models.BooleanField(default=False)
    buzzer_active = models.BooleanField(default=False)
    last_seen_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["device_id", "unit_id"]
        constraints = [models.UniqueConstraint(fields=["device", "unit_id"], name="uniq_device_unit")]

    def __str__(self) -> str:
        return f"{self.device.device_id}#{self.unit_id}"


class TelemetryLog(models.Model):
    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="telemetry")
    unit_id = models.PositiveSmallIntegerField()
    distance_cm = models.FloatField(null=True, blank=True)
    servo_position = models.PositiveSmallIntegerField(null=True, blank=True)
    detection_state = models.CharField(max_length=16, choices=DetectionState.choices)
    sensor_status = models.CharField(max_length=24, choices=SensorStatus.choices)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["device", "unit_id", "-created_at"])]


class AlertLog(models.Model):
    """One violation. The firmware repeats an alert every 60 s while an object stays
    confirmed; repeats are merged into a single row (see ingest_alert)."""

    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="alerts")
    unit_id = models.PositiveSmallIntegerField()
    event_name = models.CharField(max_length=64)
    alert_type = models.CharField(max_length=32)
    message = models.CharField(max_length=255)
    distance_cm = models.FloatField(null=True, blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    repeat_count = models.PositiveIntegerField(default=1)
    # Set when the device reports the alarm was released (iot/<id>/release): buzzer off, alerts stopped.
    # A released alert never absorbs repeats, so a new incident on the same unit opens a new row.
    released_at = models.DateTimeField(null=True, blank=True)

    is_resolved = models.BooleanField(default=False)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="resolved_alerts"
    )

    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [models.Index(fields=["is_resolved", "-updated_at"])]
