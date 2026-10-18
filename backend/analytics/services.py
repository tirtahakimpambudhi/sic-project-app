import datetime
import statistics
import zoneinfo
from rest_framework.exceptions import ValidationError

from devices.models import AlertLog, Device

WIB = zoneinfo.ZoneInfo("Asia/Jakarta")


def format_location(device: Device) -> dict:
    lat = float(device.latitude)
    lon = float(device.longitude)
    return {
        "device_id": device.device_id,
        "lokasi": device.name,
        "koordinat": f"{lat:.5f}, {lon:.5f}",
    }


def parse_analytics_params(query_params):
    """
    Validasi query params bersama:
    - start: YYYY-MM-DD
    - end: YYYY-MM-DD (inklusif)
    - device: list of device_id (boleh berulang atau dipisah koma, kosong = semua)
    Validasi: rentang maksimal 90 hari, start <= end, error 400 berbahasa Indonesia.
    """
    now_wib = datetime.datetime.now(WIB)
    today = now_wib.date()

    start_str = query_params.get("start")
    end_str = query_params.get("end")

    if not start_str and not end_str:
        # Default 14 hari terakhir (13 hari sebelum hari ini sampai hari ini)
        start_date = today - datetime.timedelta(days=13)
        end_date = today
    else:
        try:
            start_date = datetime.date.fromisoformat(start_str) if start_str else (today - datetime.timedelta(days=13))
            end_date = datetime.date.fromisoformat(end_str) if end_str else today
        except (ValueError, TypeError):
            raise ValidationError({"detail": "Format tanggal tidak valid. Gunakan format YYYY-MM-DD."})

    if start_date > end_date:
        raise ValidationError({"detail": "Tanggal mulai tidak boleh melebihi tanggal akhir."})

    if (end_date - start_date).days > 90:
        raise ValidationError({"detail": "Rentang tanggal maksimal 90 hari."})

    # Devices: can be repeated ?device=dev1&device=dev2 or comma separated ?device=dev1,dev2
    devices_raw = query_params.getlist("device")
    device_ids = []
    for item in devices_raw:
        for d in item.split(","):
            d = d.strip()
            if d and d not in device_ids:
                device_ids.append(d)

    # Convert to UTC boundaries based on Asia/Jakarta (WIB)
    start_wib = datetime.datetime.combine(start_date, datetime.time.min, tzinfo=WIB)
    end_wib = datetime.datetime.combine(end_date + datetime.timedelta(days=1), datetime.time.min, tzinfo=WIB)

    start_utc = start_wib.astimezone(datetime.timezone.utc)
    end_utc = end_wib.astimezone(datetime.timezone.utc)

    return {
        "start_date": start_date,
        "end_date": end_date,
        "device_ids": device_ids,
        "start_utc": start_utc,
        "end_utc": end_utc,
    }


def compute_summary(params):
    device_ids = params["device_ids"]
    start_utc = params["start_utc"]
    end_utc = params["end_utc"]

    devices_qs = Device.objects.all().order_by("name")
    if device_ids:
        devices_qs = devices_qs.filter(device_id__in=device_ids)
    devices = list(devices_qs)

    perangkat_total = len(devices)
    perangkat_online = sum(1 for d in devices if d.is_online)

    alerts_qs = AlertLog.objects.filter(created_at__gte=start_utc, created_at__lt=end_utc)
    if device_ids:
        alerts_qs = alerts_qs.filter(device__device_id__in=device_ids)

    total_alert = alerts_qs.count()
    alert_terbuka = alerts_qs.filter(is_resolved=False).count()
    selesai = total_alert - alert_terbuka
    persen_selesai = round((selesai / total_alert * 100), 1) if total_alert > 0 else 0.0

    # Incident resolution time: resolved_at - created_at (in minutes)
    resolve_times = [
        (res - created).total_seconds() / 60.0
        for created, res in alerts_qs.filter(is_resolved=True, resolved_at__isnull=False).values_list(
            "created_at", "resolved_at"
        )
    ]
    median_waktu_penanganan_menit = round(statistics.median(resolve_times), 1) if resolve_times else None

    # Compute per-location breakdown
    dev_stats = {
        d.device_id: {
            "device": d,
            "alert": 0,
            "terbuka": 0,
            "resolve_times": [],
            "hour_counts": [0] * 24,
        }
        for d in devices
    }

    for dev_id, created_at, is_resolved, resolved_at in alerts_qs.values_list(
        "device__device_id", "created_at", "is_resolved", "resolved_at"
    ):
        if dev_id not in dev_stats:
            continue
        stats = dev_stats[dev_id]
        stats["alert"] += 1
        if not is_resolved:
            stats["terbuka"] += 1
        if is_resolved and resolved_at:
            stats["resolve_times"].append((resolved_at - created_at).total_seconds() / 60.0)
        h = created_at.astimezone(WIB).hour
        stats["hour_counts"][h] += 1

    per_lokasi = []
    for d in devices:
        st = dev_stats[d.device_id]
        loc = format_location(d)
        max_h = max(st["hour_counts"]) if st["hour_counts"] else 0
        jam_puncak = st["hour_counts"].index(max_h) if max_h > 0 else None
        median_penanganan = round(statistics.median(st["resolve_times"]), 1) if st["resolve_times"] else None

        per_lokasi.append({
            "device_id": d.device_id,
            "lokasi": loc["lokasi"],
            "koordinat": loc["koordinat"],
            "alert": st["alert"],
            "terbuka": st["terbuka"],
            "median_penanganan_menit": median_penanganan,
            "jam_puncak": jam_puncak,
        })

    return {
        "total_alert": total_alert,
        "alert_terbuka": alert_terbuka,
        "persen_selesai": persen_selesai,
        "median_waktu_penanganan_menit": median_waktu_penanganan_menit,
        "perangkat_online": perangkat_online,
        "perangkat_total": perangkat_total,
        "per_lokasi": per_lokasi,
    }


def compute_alerts_daily(params):
    start_date = params["start_date"]
    end_date = params["end_date"]
    device_ids = params["device_ids"]
    start_utc = params["start_utc"]
    end_utc = params["end_utc"]

    devices_qs = Device.objects.all().order_by("name")
    if device_ids:
        devices_qs = devices_qs.filter(device_id__in=device_ids)
    devices = list(devices_qs)

    # Initialize full grid: (tanggal, device_id) -> {tanggal, lokasi, alert}
    grid = {}
    curr = start_date
    while curr <= end_date:
        d_str = curr.strftime("%Y-%m-%d")
        for dev in devices:
            grid[(d_str, dev.device_id)] = {
                "tanggal": d_str,
                "lokasi": dev.name,
                "alert": 0,
            }
        curr += datetime.timedelta(days=1)

    alerts_qs = AlertLog.objects.filter(created_at__gte=start_utc, created_at__lt=end_utc)
    if device_ids:
        alerts_qs = alerts_qs.filter(device__device_id__in=device_ids)

    for dev_id, created_at in alerts_qs.values_list("device__device_id", "created_at"):
        wib_date = created_at.astimezone(WIB).strftime("%Y-%m-%d")
        key = (wib_date, dev_id)
        if key in grid:
            grid[key]["alert"] += 1

    return list(grid.values())


def compute_alerts_hourly(params):
    device_ids = params["device_ids"]
    start_utc = params["start_utc"]
    end_utc = params["end_utc"]

    devices_qs = Device.objects.all().order_by("name")
    if device_ids:
        devices_qs = devices_qs.filter(device_id__in=device_ids)
    devices = list(devices_qs)

    # Initialize full grid: 24 hours (0-23) for each device
    grid = {}
    for h in range(24):
        for dev in devices:
            grid[(h, dev.device_id)] = {
                "jam": h,
                "lokasi": dev.name,
                "alert": 0,
            }

    alerts_qs = AlertLog.objects.filter(created_at__gte=start_utc, created_at__lt=end_utc)
    if device_ids:
        alerts_qs = alerts_qs.filter(device__device_id__in=device_ids)

    for dev_id, created_at in alerts_qs.values_list("device__device_id", "created_at"):
        wib_hour = created_at.astimezone(WIB).hour
        key = (wib_hour, dev_id)
        if key in grid:
            grid[key]["alert"] += 1

    return list(grid.values())
