"""Idempotent seed: demo users (from env) and the device flashed in main.cpp."""
import os

from django.core.management.base import BaseCommand

from accounts.models import Role, User
from devices.models import Device
from devices.services import device_service


class Command(BaseCommand):
    help = "Create demo operator/satpol users and the demo ESP32 device if missing."

    def handle(self, *args, **options):
        users = (
            (os.environ.get("OPERATOR_USERNAME", "operator"), os.environ.get("OPERATOR_PASSWORD", "operator123"), Role.OPERATOR),
            (os.environ.get("SATPOL_USERNAME", "satpol"), os.environ.get("SATPOL_PASSWORD", "satpol123"), Role.SATPOL_PP),
        )
        for username, password, role in users:
            user, created = User.objects.get_or_create(username=username, defaults={"role": role})
            if created:
                user.set_password(password)
                user.is_staff = role == Role.OPERATOR
                user.save()
                self.stdout.write(f"created user {username} ({role})")

        device_id = os.environ.get("DEMO_DEVICE_ID", "a4ca5bbb-f98c-4add-af1e-a498c9868dcc")
        if not Device.objects.filter(device_id=device_id).exists():
            device_service.register_device(
                device_id=device_id, name="Bahu Jalan - Titik 1", latitude=-6.208763, longitude=106.845599
            )
            self.stdout.write(f"created device {device_id}")
