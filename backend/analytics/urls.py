from django.urls import path

from .views import (
    AlertsByLocationView,
    AlertsByTypeView,
    AlertsByUnitView,
    AlertsDailyView,
    AlertsDurationView,
    AlertsExportView,
    AlertsHeatmapView,
    AlertsTableView,
    SummaryView,
    TelemetryByLocationView,
    TelemetryCoverageView,
    TelemetryDistanceView,
    TelemetryGapsView,
    TelemetryStateMixView,
)

urlpatterns = [
    # 1. Summary
    path("summary/", SummaryView.as_view(), name="analytics-summary"),

    # 2 - 8. Alerts
    path("alerts/daily/", AlertsDailyView.as_view(), name="analytics-alerts-daily"),
    path("alerts/by-location/", AlertsByLocationView.as_view(), name="analytics-alerts-by-location"),
    path("alerts/heatmap/", AlertsHeatmapView.as_view(), name="analytics-alerts-heatmap"),
    path("alerts/by-unit/", AlertsByUnitView.as_view(), name="analytics-alerts-by-unit"),
    path("alerts/by-type/", AlertsByTypeView.as_view(), name="analytics-alerts-by-type"),
    path("alerts/duration/", AlertsDurationView.as_view(), name="analytics-alerts-duration"),
    path("alerts/table/", AlertsTableView.as_view(), name="analytics-alerts-table"),
    path("alerts/export/", AlertsExportView.as_view(), name="analytics-alerts-export"),

    # 9 - 13. Telemetry
    path("telemetry/by-location/", TelemetryByLocationView.as_view(), name="analytics-telemetry-by-location"),
    path("telemetry/coverage/", TelemetryCoverageView.as_view(), name="analytics-telemetry-coverage"),
    path("telemetry/state-mix/", TelemetryStateMixView.as_view(), name="analytics-telemetry-state-mix"),
    path("telemetry/distance/", TelemetryDistanceView.as_view(), name="analytics-telemetry-distance"),
    path("telemetry/gaps/", TelemetryGapsView.as_view(), name="analytics-telemetry-gaps"),
]
