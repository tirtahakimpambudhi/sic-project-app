from django.contrib import admin

from .models import AlertLog, Device, DeviceUnit, TelemetryLog

admin.site.register(Device)
admin.site.register(DeviceUnit)
admin.site.register(TelemetryLog)
admin.site.register(AlertLog)
