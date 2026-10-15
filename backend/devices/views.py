from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from accounts.permissions import IsMonitoringUser, IsOperator

from .models import AlertLog, Device
from .serializers import (
    AddUnitSerializer,
    AlertLogSerializer,
    DeviceSerializer,
    ReleaseSerializer,
    TelemetryLogSerializer,
    UnsetUnitsSerializer,
)
from .services import device_service
from .services.device_service import DeviceCommandError

GENERAL_FIELDS = {"tolerant_distance_cm", "timeout_seconds", "latitude", "longitude"}


def _command_error_response(exc: DeviceCommandError) -> Response:
    return Response({"code": exc.code, "detail": exc.detail}, status=exc.status_code)


class DeviceViewSet(viewsets.ModelViewSet):
    """Operators manage devices; Satpol PP may only read them (monitoring)."""

    serializer_class = DeviceSerializer
    lookup_field = "device_id"
    lookup_value_regex = r"[\w-]+"
    pagination_class = None

    READ_ACTIONS = {"list", "retrieve", "telemetry"}
    # Silencing a latched alarm is part of handling an alert, so field officers may do it too.
    MONITORING_ACTIONS = READ_ACTIONS | {"release"}

    def get_permissions(self):
        permission = IsMonitoringUser if self.action in self.MONITORING_ACTIONS else IsOperator
        return [permission()]

    def get_queryset(self):
        return (
            Device.objects.prefetch_related("units")
            .annotate(open_alert_count=Count("alerts", filter=Q(alerts__is_resolved=False)))
            .order_by("name")
        )

    def perform_create(self, serializer):
        serializer.instance = device_service.register_device(**serializer.validated_data)

    def perform_update(self, serializer):
        changed_general = GENERAL_FIELDS & set(serializer.validated_data)
        device = serializer.save()
        if changed_general:
            try:
                device_service.push_general_config(device)
            except DeviceCommandError as exc:
                raise ValidationError(
                    {"detail": f"Tersimpan di server, tetapi belum terkirim ke perangkat: {exc.detail}"}
                ) from exc

    @action(detail=True, methods=["post"], url_path="units")
    def add_unit(self, request, device_id=None):
        device = self.get_object()
        serializer = AddUnitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            payload = device_service.request_add_unit(device, **serializer.validated_data)
        except DeviceCommandError as exc:
            return _command_error_response(exc)
        return Response(
            {"detail": "Perintah dikirim. Menunggu konfirmasi perangkat.", "command": payload},
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=["post"], url_path="units/unset")
    def unset_units(self, request, device_id=None):
        device = self.get_object()
        serializer = UnsetUnitsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            payload = device_service.request_unset_units(device, serializer.validated_data["unit_ids"])
        except DeviceCommandError as exc:
            return _command_error_response(exc)
        return Response(
            {"detail": "Perintah dikirim. Menunggu konfirmasi perangkat.", "command": payload},
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=["post"], url_path="release")
    def release(self, request, device_id=None):
        """Stop alerts and silence the buzzer. Body: {} (all units in alarm) or {"unit_ids": [1, 2]}."""
        device = self.get_object()
        serializer = ReleaseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            payload = device_service.request_release(device, serializer.validated_data.get("unit_ids"))
        except DeviceCommandError as exc:
            return _command_error_response(exc)
        return Response(
            {"detail": "Perintah release dikirim. Menunggu konfirmasi perangkat.", "command": payload},
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=["get"])
    def telemetry(self, request, device_id=None):
        device = self.get_object()
        limit = min(int(request.query_params.get("limit", 40)), 500)
        logs = device.telemetry.all()
        if "unit_id" in request.query_params:
            logs = logs.filter(unit_id=request.query_params["unit_id"])
        return Response(TelemetryLogSerializer(logs[:limit], many=True).data)


class AlertViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Alert log. Both roles can review and resolve; alerts are created only by devices via MQTT."""

    serializer_class = AlertLogSerializer
    permission_classes = [IsMonitoringUser]

    def get_queryset(self):
        queryset = AlertLog.objects.select_related("device", "resolved_by")
        params = self.request.query_params
        if "is_resolved" in params:
            queryset = queryset.filter(is_resolved=params["is_resolved"].lower() == "true")
        if "device" in params:
            queryset = queryset.filter(device__device_id=params["device"])
        return queryset

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        alert = self.get_object()
        if not alert.is_resolved:
            alert.is_resolved = True
            alert.resolved_by = request.user
            alert.resolved_at = timezone.now()
            alert.save(update_fields=["is_resolved", "resolved_by", "resolved_at"])
        return Response(self.get_serializer(alert).data)
