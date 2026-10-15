from rest_framework import serializers

from .models import AlertLog, Device, DeviceUnit, TelemetryLog

def gpio_field():
    return serializers.IntegerField(min_value=0, max_value=39)


class DeviceUnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeviceUnit
        fields = (
            "unit_id", "is_default", "has_setup", "trig_pin", "echo_pin", "servo_pin", "buzzer_pin",
            "detection_state", "is_object_detected", "buzzer_active",
            "last_distance_cm", "servo_position", "last_seen",
        )


class DeviceSerializer(serializers.ModelSerializer):
    units = DeviceUnitSerializer(many=True, read_only=True)
    is_online = serializers.BooleanField(read_only=True)
    open_alert_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Device
        fields = (
            "device_id", "name", "latitude", "longitude", "tolerant_distance_cm", "timeout_seconds",
            "is_online", "last_seen", "last_operation", "setup_result", "setup_detail", "setup_reported_at",
            "units", "open_alert_count", "created_at",
        )
        read_only_fields = ("last_seen", "last_operation", "setup_result", "setup_detail", "setup_reported_at")

    def update(self, instance, validated_data):
        validated_data.pop("device_id", None)  # the id is baked into MQTT topics; it never changes
        return super().update(instance, validated_data)


class AddUnitSerializer(serializers.Serializer):
    trig_pin = gpio_field()
    echo_pin = gpio_field()
    servo_pin = gpio_field()
    buzzer_pin = gpio_field()


class ReleaseSerializer(serializers.Serializer):
    """Omit unit_ids to release every unit that is currently in alarm."""

    unit_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=3), allow_empty=False, required=False
    )


class UnsetUnitsSerializer(serializers.Serializer):
    unit_ids = serializers.ListField(child=serializers.IntegerField(min_value=0, max_value=3), allow_empty=False)


class TelemetryLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = TelemetryLog
        fields = ("id", "unit_id", "distance_cm", "servo_position", "detection_state", "created_at")


class AlertLogSerializer(serializers.ModelSerializer):
    device_id = serializers.CharField(source="device.device_id", read_only=True)
    device_name = serializers.CharField(source="device.name", read_only=True)
    resolved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = AlertLog
        fields = (
            "id", "device_id", "device_name", "unit_id", "event_name", "alert_type", "message",
            "distance_cm", "latitude", "longitude", "occurrences", "created_at", "last_occurred_at",
            "released_at", "is_resolved", "resolved_by_name", "resolved_at",
        )

    def get_resolved_by_name(self, obj):
        if not obj.resolved_by:
            return None
        return obj.resolved_by.get_full_name() or obj.resolved_by.username
