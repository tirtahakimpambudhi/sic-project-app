from django.core.paginator import Paginator
from django.http import HttpResponse
from rest_framework import status
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsMonitoringUser
from . import services


class CSVRenderer(BaseRenderer):
    media_type = "text/csv"
    format = "csv"
    charset = "utf-8"

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return data if isinstance(data, (bytes, str)) else str(data)


class AnalyticsBaseView(APIView):
    permission_classes = [IsMonitoringUser]

    def get_params(self, request):
        return services.parse_analytics_params(request.query_params)


# 1. GET /api/analytics/summary/
class SummaryView(AnalyticsBaseView):
    def get(self, request):
        params = self.get_params(request)
        data = services.get_cached_or_compute(
            "summary", params, lambda: services.compute_summary(params)
        )
        return Response(data)


# 2. GET /api/analytics/alerts/daily/
class AlertsDailyView(AnalyticsBaseView):
    def get(self, request):
        params = self.get_params(request)
        data = services.get_cached_or_compute(
            "alerts_daily", params, lambda: services.compute_alerts_daily(params)
        )
        return Response(data)


# 3. GET /api/analytics/alerts/by-location/
class AlertsByLocationView(AnalyticsBaseView):
    def get(self, request):
        params = self.get_params(request)
        data = services.get_cached_or_compute(
            "alerts_by_location", params, lambda: services.compute_alerts_by_location(params)
        )
        return Response(data)


# 4. GET /api/analytics/alerts/heatmap/
class AlertsHeatmapView(AnalyticsBaseView):
    def get(self, request):
        params = self.get_params(request)
        data = services.get_cached_or_compute(
            "alerts_heatmap", params, lambda: services.compute_alerts_heatmap(params)
        )
        return Response(data)


# 5. GET /api/analytics/alerts/by-unit/
class AlertsByUnitView(AnalyticsBaseView):
    def get(self, request):
        params = self.get_params(request)
        data = services.get_cached_or_compute(
            "alerts_by_unit", params, lambda: services.compute_alerts_by_unit(params)
        )
        return Response(data)


# 6. GET /api/analytics/alerts/by-type/
class AlertsByTypeView(AnalyticsBaseView):
    def get(self, request):
        params = self.get_params(request)
        data = services.get_cached_or_compute(
            "alerts_by_type", params, lambda: services.compute_alerts_by_type(params)
        )
        return Response(data)


# 7. GET /api/analytics/alerts/duration/
class AlertsDurationView(AnalyticsBaseView):
    def get(self, request):
        params = self.get_params(request)
        data = services.get_cached_or_compute(
            "alerts_duration", params, lambda: services.compute_alerts_duration(params)
        )
        return Response(data)


# 8. GET /api/analytics/alerts/table/ (supports ?format=csv or /alerts/export/)
class AlertsTableView(AnalyticsBaseView):
    renderer_classes = [JSONRenderer, CSVRenderer]

    def get(self, request):
        params = self.get_params(request)
        status_filter = request.query_params.get("status", "semua").lower()
        if status_filter not in ("terbuka", "selesai", "semua"):
            status_filter = "semua"

        alerts_qs = services.get_alerts_table_qs(params, status_filter)

        # Handle CSV format
        if request.query_params.get("format") == "csv" or request.query_params.get("export") == "csv":
            csv_content = services.generate_alerts_csv(alerts_qs)
            response = HttpResponse(csv_content, content_type="text/csv; charset=utf-8")
            response["Content-Disposition"] = 'attachment; filename="alerts.csv"'
            return response

        page_number = int(request.query_params.get("page", 1))
        page_size = min(int(request.query_params.get("page_size", 50)), 100)

        paginator = Paginator(alerts_qs, page_size)
        page_obj = paginator.get_page(page_number)

        results = [services.serialize_alert_row(a) for a in page_obj.object_list]

        return Response({
            "count": paginator.count,
            "total_pages": paginator.num_pages,
            "current_page": page_obj.number,
            "next": page_obj.next_page_number() if page_obj.has_next() else None,
            "previous": page_obj.previous_page_number() if page_obj.has_previous() else None,
            "results": results,
        })


class AlertsExportView(AnalyticsBaseView):
    renderer_classes = [CSVRenderer]

    def get(self, request):
        params = self.get_params(request)
        status_filter = request.query_params.get("status", "semua").lower()
        if status_filter not in ("terbuka", "selesai", "semua"):
            status_filter = "semua"

        alerts_qs = services.get_alerts_table_qs(params, status_filter)
        csv_content = services.generate_alerts_csv(alerts_qs)
        response = HttpResponse(csv_content, content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="alerts.csv"'
        return response


# 9. GET /api/analytics/telemetry/by-location/
class TelemetryByLocationView(AnalyticsBaseView):
    def get(self, request):
        params = self.get_params(request)
        data = services.get_cached_or_compute(
            "tel_by_location", params, lambda: services.compute_telemetry_by_location(params)
        )
        return Response(data)


# 10. GET /api/analytics/telemetry/coverage/
class TelemetryCoverageView(AnalyticsBaseView):
    def get(self, request):
        params = self.get_params(request)
        data = services.get_cached_or_compute(
            "tel_coverage", params, lambda: services.compute_telemetry_coverage(params)
        )
        return Response(data)


# 11. GET /api/analytics/telemetry/state-mix/
class TelemetryStateMixView(AnalyticsBaseView):
    def get(self, request):
        params = self.get_params(request)
        data = services.get_cached_or_compute(
            "tel_state_mix", params, lambda: services.compute_telemetry_state_mix(params)
        )
        return Response(data)


# 12. GET /api/analytics/telemetry/distance/?device=<satu>&unit_id=<n>
class TelemetryDistanceView(AnalyticsBaseView):
    def get(self, request):
        params = self.get_params(request)
        device_id = request.query_params.get("device")
        if not device_id and params["device_ids"]:
            device_id = params["device_ids"][0]
        try:
            unit_id = int(request.query_params.get("unit_id", 0))
        except (ValueError, TypeError):
            unit_id = 0

        extra_k = f"{device_id}_{unit_id}"
        data = services.get_cached_or_compute(
            "tel_distance", params,
            lambda: services.compute_telemetry_distance(params, device_id, unit_id),
            extra_key=extra_k,
        )
        return Response(data)


# 13. GET /api/analytics/telemetry/gaps/
class TelemetryGapsView(AnalyticsBaseView):
    def get(self, request):
        params = self.get_params(request)
        data = services.get_cached_or_compute(
            "tel_gaps", params, lambda: services.compute_telemetry_gaps(params)
        )
        return Response(data)
