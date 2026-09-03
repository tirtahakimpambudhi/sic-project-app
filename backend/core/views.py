from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.generics import RetrieveAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from core.models import AlertLog, Device, TelemetryLog
from core.permissions import IsOperator, IsSatpolPP
from core.serializers import (
    AlertSerializer,
    DeviceSerializer,
    GeneralConfigSerializer,
    SetConfigSerializer,
    TelemetrySerializer,
    UnsetConfigSerializer,
    UserSerializer,
)
from core.services.device_service import (
    AddUnitCommand,
    DeviceCommandError,
    DeviceService,
    GeneralParams,
    PublishedCommand,
)
from core.services.mqtt_service import MqttUnavailableError

GENERAL_FIELDS = ("tolerant_distance_cm", "timeout_seconds", "latitude", "longitude")


def parse_limit(raw: str | None, *, default: int, maximum: int) -> int:
    return min(int(raw), maximum) if raw is not None and raw.isdigit() and int(raw) > 0 else default


class MeView(RetrieveAPIView):
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


class DeviceViewSet(viewsets.ModelViewSet):
    """Read: any authenticated user. Write and every MQTT command: operator only."""

    serializer_class = DeviceSerializer
    queryset = Device.objects.prefetch_related("units")
    device_service = DeviceService()

    def get_permissions(self):
        if self.action in ("list", "retrieve", "telemetry"):
            return [IsAuthenticated()]
        return [IsOperator()]

    @staticmethod
    def _accepted(command: PublishedCommand) -> Response:
        # 202: the command was handed to the broker; the device's verdict arrives later
        # on config/status and shows up on the Device (last_config_result).
        return Response({"topic": command.topic, "payload": command.payload}, status=status.HTTP_202_ACCEPTED)

    @staticmethod
    def _error(exc: DeviceCommandError | MqttUnavailableError) -> Response:
        if isinstance(exc, DeviceCommandError):
            return Response({"detail": exc.message, "code": exc.code}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": str(exc), "code": "mqtt_unavailable"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    @action(detail=True, methods=["post"], url_path="units")
    def add_unit(self, request: Request, pk=None) -> Response:
        device = self.get_object()
        serializer = SetConfigSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        command = AddUnitCommand(
            trig_pin=data["sensor"]["trig_pin"],
            echo_pin=data["sensor"]["echo_pin"],
            servo_pin=data["servo"]["pin"],
            params=GeneralParams(**{key: data.get(key) for key in GENERAL_FIELDS}),
        )
        try:
            return self._accepted(self.device_service.add_unit(device, command))
        except (DeviceCommandError, MqttUnavailableError) as exc:
            return self._error(exc)

    @action(detail=True, methods=["post"], url_path="units/unset")
    def remove_units(self, request: Request, pk=None) -> Response:
        device = self.get_object()
        serializer = UnsetConfigSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            return self._accepted(self.device_service.remove_units(device, serializer.validated_data["unit_ids"]))
        except (DeviceCommandError, MqttUnavailableError) as exc:
            return self._error(exc)

    @action(detail=True, methods=["post"], url_path="general")
    def general(self, request: Request, pk=None) -> Response:
        device = self.get_object()
        serializer = GeneralConfigSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        params = GeneralParams(**{key: serializer.validated_data.get(key) for key in GENERAL_FIELDS})
        try:
            return self._accepted(self.device_service.update_general(device, params))
        except (DeviceCommandError, MqttUnavailableError) as exc:
            return self._error(exc)

    @action(detail=True, methods=["get"], url_path="telemetry")
    def telemetry(self, request: Request, pk=None) -> Response:
        device = self.get_object()
        queryset = TelemetryLog.objects.filter(device=device)
        unit_id = request.query_params.get("unit_id")
        if unit_id is not None and unit_id.isdigit():
            queryset = queryset.filter(unit_id=int(unit_id))
        limit = parse_limit(request.query_params.get("limit"), default=100, maximum=500)
        return Response(TelemetrySerializer(queryset[:limit], many=True).data)


class AlertViewSet(viewsets.ReadOnlyModelViewSet):
    """Satpol PP and operators can read and resolve alerts."""

    serializer_class = AlertSerializer
    queryset = AlertLog.objects.select_related("device", "resolved_by")
    MAX_LIMIT = 200

    def get_permissions(self):
        return [(IsOperator | IsSatpolPP)()]

    def list(self, request: Request, *args, **kwargs) -> Response:
        queryset = self.get_queryset()
        resolved = request.query_params.get("resolved")
        if resolved in ("true", "false"):
            queryset = queryset.filter(is_resolved=resolved == "true")
        limit = parse_limit(request.query_params.get("limit"), default=50, maximum=self.MAX_LIMIT)
        return Response(self.get_serializer(queryset[:limit], many=True).data)

    @action(detail=True, methods=["post"])
    def resolve(self, request: Request, pk=None) -> Response:
        alert = self.get_object()
        if not alert.is_resolved:
            alert.is_resolved = True
            alert.resolved_at = timezone.now()
            alert.resolved_by = request.user
            alert.save(update_fields=["is_resolved", "resolved_at", "resolved_by", "updated_at"])
        return Response(self.get_serializer(alert).data)
