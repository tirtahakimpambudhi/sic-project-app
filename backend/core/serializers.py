from rest_framework import serializers

from core.models import AlertLog, Device, DeviceUnit, TelemetryLog, User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "role"]
        read_only_fields = fields


class DeviceUnitSerializer(serializers.ModelSerializer):
    source = serializers.SerializerMethodField()

    class Meta:
        model = DeviceUnit
        fields = [
            "unit_id", "source", "is_default", "has_setup",
            "trig_pin", "echo_pin", "servo_pin", "buzzer_pin",
            "detection_state", "is_object_detected", "buzzer_active", "sensor_status", "last_distance_cm", "servo_position", "last_seen_at",
        ]
        read_only_fields = fields

    def get_source(self, obj: DeviceUnit) -> str:
        return "default" if obj.is_default else "dynamic"


class DeviceSerializer(serializers.ModelSerializer):
    units = DeviceUnitSerializer(many=True, read_only=True)
    is_online = serializers.BooleanField(read_only=True)
    device_type = serializers.SerializerMethodField()

    class Meta:
        model = Device
        fields = [
            "id", "device_id", "name", "latitude", "longitude",
            "tolerant_distance_cm", "timeout_seconds",
            "is_online", "last_seen_at",
            "last_operation", "last_config_result", "last_config_detail", "last_config_at",
            "units", "created_at", "device_type",
        ]
        # Runtime values belong to the device (reported over MQTT); the API only owns identity + location.
        read_only_fields = [
            "id", "tolerant_distance_cm", "timeout_seconds", "last_seen_at", "last_operation",
            "last_config_result", "last_config_detail", "last_config_at", "created_at", "device_type",
        ]

    def get_device_type(self, obj):
        return getattr(obj, "device_type", None) or "ESP32"

    def validate_device_id(self, value: str) -> str:
        # device_id is the MQTT topic segment; changing it would orphan the device.
        if self.instance is not None and value != self.instance.device_id:
            raise serializers.ValidationError("device_id tidak dapat diubah setelah dibuat.")
        return value


class TelemetrySerializer(serializers.ModelSerializer):
    class Meta:
        model = TelemetryLog
        fields = ["id", "unit_id", "distance_cm", "servo_position", "detection_state", "sensor_status", "created_at"]
        read_only_fields = fields


class AlertSerializer(serializers.ModelSerializer):
    device_name = serializers.CharField(source="device.name", read_only=True)
    device_uid = serializers.CharField(source="device.device_id", read_only=True)
    resolved_by = serializers.CharField(source="resolved_by.username", read_only=True, default=None)

    class Meta:
        model = AlertLog
        fields = [
            "id", "device", "device_name", "device_uid", "unit_id", "event_name", "alert_type", "message",
            "distance_cm", "latitude", "longitude", "repeat_count",
            "released_at", "is_resolved", "resolved_at", "resolved_by", "created_at", "updated_at",
        ]
        read_only_fields = fields


# ----------------------------------------------------------------------------- command inputs
# Shape and type checks only. Domain rules (pin conflicts, ranges, unit 0) live in DeviceService.
class _GeneralFields(serializers.Serializer):
    tolerant_distance_cm = serializers.FloatField(required=False)
    timeout_seconds = serializers.IntegerField(required=False)
    latitude = serializers.FloatField(required=False)
    longitude = serializers.FloatField(required=False)


class SensorPinsSerializer(serializers.Serializer):
    trig_pin = serializers.IntegerField()
    echo_pin = serializers.IntegerField()


class ServoPinSerializer(serializers.Serializer):
    pin = serializers.IntegerField()


class BuzzerPinSerializer(serializers.Serializer):
    pin = serializers.IntegerField()


class SetConfigSerializer(_GeneralFields):
    sensor = SensorPinsSerializer()
    servo = ServoPinSerializer()
    buzzer = BuzzerPinSerializer()


class UnsetConfigSerializer(serializers.Serializer):
    unit_ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)


class GeneralConfigSerializer(_GeneralFields):
    pass


class ReleaseSerializer(serializers.Serializer):
    """Omit unit_ids to release every unit that is currently in alarm."""

    unit_ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=False, required=False)
