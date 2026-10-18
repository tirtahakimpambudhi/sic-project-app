from django.urls import path

from .views import (
    AlertsDailyView,
    AlertsHourlyView,
    SummaryView,
)

urlpatterns = [
    path("summary/", SummaryView.as_view(), name="analytics-summary"),
    path("alerts/daily/", AlertsDailyView.as_view(), name="analytics-alerts-daily"),
    path("alerts/hourly/", AlertsHourlyView.as_view(), name="analytics-alerts-hourly"),
]
