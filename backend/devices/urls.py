from rest_framework.routers import DefaultRouter

from .views import AlertViewSet, DeviceViewSet

router = DefaultRouter()
router.register("devices", DeviceViewSet, basename="device")
router.register("alerts", AlertViewSet, basename="alert")

urlpatterns = router.urls
