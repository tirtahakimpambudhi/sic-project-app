"""Run the MQTT subscriber: `python manage.py run_mqtt`."""
import signal
import threading

from django.core.management.base import BaseCommand

from core.services.mqtt_service import MqttService


class Command(BaseCommand):
    help = "Subscribe to iot/+/telemetry, alert and config/status and persist them."

    def handle(self, *args, **options) -> None:
        service = MqttService(subscribe=True, role="worker")
        stop = threading.Event()
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda *_: stop.set())

        service.start()
        self.stdout.write("MQTT worker running. Ctrl+C to stop.")
        stop.wait()
        service.stop()
