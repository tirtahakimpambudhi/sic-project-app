import datetime
import zoneinfo
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Role
from devices.models import AlertLog, Device, DeviceUnit

User = get_user_model()
WIB = zoneinfo.ZoneInfo("Asia/Jakarta")


class AnalyticsMVPTestCase(TestCase):
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

        oct_15 = [d for d in daily_list if d["tanggal"] == "2026-10-15"]
        oct_16 = [d for d in daily_list if d["tanggal"] == "2026-10-16"]

        self.assertEqual(len(oct_15), 1)
        self.assertEqual(oct_15[0]["alert"], 1)

        self.assertEqual(len(oct_16), 1)
        self.assertEqual(oct_16[0]["alert"], 0)  # Hari tanpa alert harus 0

    def test_kpi_and_summary_calculations(self):
        self.client.force_authenticate(user=self.operator)

        base_time = datetime.datetime(2026, 10, 10, 10, 0, 0, tzinfo=WIB).astimezone(datetime.timezone.utc)

        # Alert 1: diselesaikan setelah 20 menit, durasi 10 menit
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

        # Alert 2: belum selesai (terbuka), durasi 30 menit
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
        self.assertEqual(s["median_waktu_penanganan_menit"], 20.0)
        self.assertEqual(s["perangkat_total"], 1)
        self.assertEqual(s["perangkat_online"], 1)

        self.assertEqual(len(s["per_lokasi"]), 1)
        loc = s["per_lokasi"][0]
        self.assertEqual(loc["device_id"], "dev-test-01")
        self.assertEqual(loc["lokasi"], "Bahu Jalan Sudirman")
        self.assertEqual(loc["koordinat"], "-6.20880, 106.84560")
        self.assertEqual(loc["alert"], 2)
        self.assertEqual(loc["terbuka"], 1)
        self.assertEqual(loc["median_penanganan_menit"], 20.0)
        # Jam puncak: alert dibuat pada jam 10 dan 11 WIB, masing-masing 1
        self.assertIn(loc["jam_puncak"], [10, 11])

    def test_hourly_alerts_endpoint(self):
        self.client.force_authenticate(user=self.operator)

        # Alert dibuat pada jam 14:00 WIB (07:00 UTC)
        t_14_wib = datetime.datetime(2026, 10, 12, 14, 15, 0, tzinfo=WIB).astimezone(datetime.timezone.utc)
        AlertLog.objects.create(
            device=self.device1,
            unit_id=0,
            event_name="parkir_liar",
            alert_type="illegal_parking",
            message="Test Hourly",
            occurrences=1,
            created_at=t_14_wib,
            last_occurred_at=t_14_wib,
            is_resolved=False,
        )

        res = self.client.get("/api/analytics/alerts/hourly/?start=2026-10-12&end=2026-10-12")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        hourly_list = res.data

        self.assertEqual(len(hourly_list), 24)
        h14 = [h for h in hourly_list if h["jam"] == 14]
        h0 = [h for h in hourly_list if h["jam"] == 0]

        self.assertEqual(len(h14), 1)
        self.assertEqual(h14[0]["alert"], 1)
        self.assertEqual(len(h0), 1)
        self.assertEqual(h0[0]["alert"], 0)
