import datetime
import zoneinfo
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Role
from devices.models import AlertLog, Device, DeviceUnit, TelemetryLog

User = get_user_model()
WIB = zoneinfo.ZoneInfo("Asia/Jakarta")


class AnalyticsTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Users
        self.operator = User.objects.create_user(
            username="test_operator", password="password123", role=Role.OPERATOR
        )
        self.satpol = User.objects.create_user(
            username="test_satpol", password="password123", role=Role.SATPOL_PP
        )

        # Device
        self.device1 = Device.objects.create(
            device_id="dev-test-01",
            name="Bahu Jalan Sudirman",
            latitude=-6.20880,
            longitude=106.84560,
            tolerant_distance_cm=10.0,
            timeout_seconds=300,
            last_seen=timezone.now(),
        )
        self.unit0 = DeviceUnit.objects.create(
            device=self.device1,
            unit_id=0,
            is_default=True,
            has_setup=True,
        )

    def test_permissions(self):
        url = "/api/analytics/summary/"

        # 1. Unauthenticated -> 401
        res = self.client.get(url)
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

        # 2. Satpol PP -> 200
        self.client.force_authenticate(user=self.satpol)
        res = self.client.get(url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # 3. Operator -> 200
        self.client.force_authenticate(user=self.operator)
        res = self.client.get(url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_validation_errors(self):
        self.client.force_authenticate(user=self.operator)

        # Invalid format -> 400
        res = self.client.get("/api/analytics/summary/?start=invalid-date")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Format tanggal tidak valid", str(res.data.get("detail", "")))

        # start > end -> 400
        res = self.client.get("/api/analytics/summary/?start=2026-10-18&end=2026-10-10")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Tanggal mulai tidak boleh melebihi tanggal akhir", str(res.data.get("detail", "")))

        # Range > 90 days -> 400
        res = self.client.get("/api/analytics/summary/?start=2026-01-01&end=2026-04-10")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Rentang tanggal maksimal 90 hari", str(res.data.get("detail", "")))

    def test_timezone_grouping_23_30_wib(self):
        """
        Alert yang dibuat pukul 23:30 WIB harus jatuh di hari WIB yang benar.
        Contoh: 2026-10-15 23:30 WIB = 2026-10-15 16:30 UTC.
        Di database disimpan 2026-10-15 16:30 UTC.
        Di endpoint daily alert untuk tanggal 2026-10-15 harus tercatat 1 alert,
        bukan di tanggal 2026-10-16.
        """
        self.client.force_authenticate(user=self.operator)

        # Buat alert pada 2026-10-15 23:30 WIB
        dt_wib = datetime.datetime(2026, 10, 15, 23, 30, 0, tzinfo=WIB)
        dt_utc = dt_wib.astimezone(datetime.timezone.utc)

        AlertLog.objects.create(
            device=self.device1,
            unit_id=0,
            event_name="parkir_liar",
            alert_type="illegal_parking",
            message="Kendaraan terdeteksi parkir di bahu jalan",
            occurrences=1,
            created_at=dt_utc,
            last_occurred_at=dt_utc + datetime.timedelta(minutes=10),
            is_resolved=False,
        )

        res = self.client.get("/api/analytics/alerts/daily/?start=2026-10-15&end=2026-10-16")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        daily_list = res.data

        # Cari data tanggal 2026-10-15
        oct_15 = [d for d in daily_list if d["tanggal"] == "2026-10-15"]
        oct_16 = [d for d in daily_list if d["tanggal"] == "2026-10-16"]

        self.assertEqual(len(oct_15), 1)
        self.assertEqual(oct_15[0]["alert"], 1)

        self.assertEqual(len(oct_16), 1)
        self.assertEqual(oct_16[0]["alert"], 0)  # Hari tanpa alert harus 0

    def test_kpi_and_summary_calculations(self):
        self.client.force_authenticate(user=self.operator)

        base_time = datetime.datetime(2026, 10, 10, 10, 0, 0, tzinfo=WIB).astimezone(datetime.timezone.utc)

        # Alert 1: diselesaikan setelah 20 menit, durasi 10 menit, 3 occurrences
        AlertLog.objects.create(
            device=self.device1,
            unit_id=0,
            event_name="parkir_liar",
            alert_type="illegal_parking",
            message="Test 1",
            occurrences=3,
            created_at=base_time,
            last_occurred_at=base_time + datetime.timedelta(minutes=10),
            is_resolved=True,
            resolved_at=base_time + datetime.timedelta(minutes=20),
            resolved_by=self.operator,
        )

        # Alert 2: belum selesai (terbuka), durasi 30 menit, 2 occurrences
        AlertLog.objects.create(
            device=self.device1,
            unit_id=0,
            event_name="pkl_trotoar",
            alert_type="street_vendor",
            message="Test 2",
            occurrences=2,
            created_at=base_time + datetime.timedelta(hours=1),
            last_occurred_at=base_time + datetime.timedelta(hours=1, minutes=30),
            is_resolved=False,
        )

        res = self.client.get("/api/analytics/summary/?start=2026-10-09&end=2026-10-11")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        s = res.data

        self.assertEqual(s["total_alert"], 2)
        self.assertEqual(s["alert_terbuka"], 1)
        self.assertEqual(s["persen_selesai"], 50.0)
        self.assertEqual(s["total_pengulangan"], 5)
        self.assertEqual(s["median_waktu_penanganan_menit"], 20.0)
        # Rata2 durasi: (10 + 30) / 2 = 20.0
        self.assertEqual(s["rata2_durasi_insiden_menit"], 20.0)
        self.assertEqual(s["perangkat_total"], 1)
        self.assertEqual(s["perangkat_online"], 1)
        self.assertEqual(len(s["lokasi"]), 1)
        self.assertEqual(s["lokasi"][0]["koordinat"], "-6.20880, 106.84560")

    def test_telemetry_metrics_and_coverage(self):
        self.client.force_authenticate(user=self.operator)

        # Set 360 readings in one hour -> 360 / (3600/5) = 360 / 720 = 50% kelengkapan
        t0 = datetime.datetime(2026, 10, 10, 8, 0, 0, tzinfo=WIB).astimezone(datetime.timezone.utc)
        telemetries = []
        for i in range(360):
            telemetries.append(
                TelemetryLog(
                    device=self.device1,
                    unit_id=0,
                    distance_cm=25.0 if i % 2 == 0 else None,  # 50% tanpa echo
                    detection_state="confirmed" if i < 36 else "scanning",  # 10% confirmed
                    created_at=t0 + datetime.timedelta(seconds=i * 5),
                )
            )
        TelemetryLog.objects.bulk_create(telemetries)

        res = self.client.get("/api/analytics/telemetry/by-location/?start=2026-10-10&end=2026-10-10")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.data
        self.assertEqual(len(data), 1)
        item = data[0]
        self.assertEqual(item["bacaan"], 360)
        self.assertEqual(item["kelengkapan_persen"], 50.0)
        self.assertEqual(item["persen_tanpa_echo"], 50.0)
        self.assertEqual(item["persen_confirmed"], 10.0)
        self.assertEqual(item["jarak_median_cm"], 25.0)

    def test_alerts_table_pagination_and_csv(self):
        self.client.force_authenticate(user=self.operator)

        t0 = datetime.datetime(2026, 10, 10, 10, 0, 0, tzinfo=WIB).astimezone(datetime.timezone.utc)
        AlertLog.objects.create(
            device=self.device1,
            unit_id=0,
            event_name="parkir_liar",
            alert_type="illegal_parking",
            message="Test CSV",
            occurrences=1,
            created_at=t0,
            last_occurred_at=t0,
            is_resolved=False,
        )

        # JSON table
        res = self.client.get("/api/analytics/alerts/table/?start=2026-10-09&end=2026-10-11")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn("results", res.data)
        self.assertEqual(res.data["count"], 1)
        self.assertEqual(res.data["results"][0]["lokasi"], "Bahu Jalan Sudirman")

        # CSV format
        res_csv = self.client.get("/api/analytics/alerts/table/?start=2026-10-09&end=2026-10-11&format=csv")
        self.assertEqual(res_csv.status_code, status.HTTP_200_OK)
        self.assertEqual(res_csv["Content-Type"], "text/csv; charset=utf-8")
        content = res_csv.content.decode("utf-8")
        self.assertIn("Bahu Jalan Sudirman", content)
        self.assertIn("Waktu Dibuat (WIB)", content)
