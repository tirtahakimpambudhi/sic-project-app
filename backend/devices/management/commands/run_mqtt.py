"""Long-running MQTT worker: `python manage.py run_mqtt`.

Runs as its own container so the subscription exists exactly once, independent of how many
gunicorn workers serve the API.
"""
import signal
import threading

from django.core.management.base import BaseCommand

from devices.services.mqtt_service import MqttListener


class Command(BaseCommand):
    help = "Subscribe to iot/+/telemetry, iot/+/alert and iot/+/config/status and persist them."

    def handle(self, *args, **options):
        stop = threading.Event()
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda *_: stop.set())

        listener = MqttListener()
        listener.start()
        self.stdout.write(self.style.SUCCESS("MQTT listener running. Ctrl+C to stop."))
        stop.wait()
        listener.stop()
