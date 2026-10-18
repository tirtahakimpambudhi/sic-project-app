from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsMonitoringUser
from . import services


class AnalyticsBaseView(APIView):
    permission_classes = [IsMonitoringUser]

    def get_params(self, request):
        return services.parse_analytics_params(request.query_params)


# 1. GET /api/analytics/summary/
class SummaryView(AnalyticsBaseView):
    def get(self, request):
        params = self.get_params(request)
        data = services.compute_summary(params)
        return Response(data)


# 2. GET /api/analytics/alerts/daily/
class AlertsDailyView(AnalyticsBaseView):
    def get(self, request):
        params = self.get_params(request)
        data = services.compute_alerts_daily(params)
        return Response(data)


# 3. GET /api/analytics/alerts/hourly/
class AlertsHourlyView(AnalyticsBaseView):
    def get(self, request):
        params = self.get_params(request)
        data = services.compute_alerts_hourly(params)
        return Response(data)
