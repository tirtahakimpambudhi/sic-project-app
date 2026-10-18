import csv
import datetime
import io
import math
import statistics
import zoneinfo
from django.conf import settings
from django.core.cache import cache
from django.db.models import Count, Q, Sum
from rest_framework.exceptions import ValidationError

from devices.models import AlertLog, Device, DeviceUnit, TelemetryLog

WIB = zoneinfo.ZoneInfo("Asia/Jakarta")


def get_telemetry_interval() -> float:
    return float(getattr(settings, "TELEMETRY_INTERVAL_SECONDS", 5))


def format_location(device: Device) -> dict:
    lat = float(device.latitude)
    lon = float(device.longitude)
    return {
        "device_id": device.device_id,
        "lokasi": device.name,
        "koordinat": f"{lat:.5f}, {lon:.5f}",
        "latitude": round(lat, 5),
        "longitude": round(lon, 5),
    }


def parse_analytics_params(query_params):
    """
    Validasi query params bersama:
    - start: YYYY-MM-DD
    - end: YYYY-MM-DD (inklusif)
    - device: list of device_id (boleh berulang, kosong = semua)
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

    # Devices: can be repeated ?device=dev1&device=dev2 or comma separated
    devices_raw = query_params.getlist("device")
    device_ids = []
    for item in devices_raw:
        for d in item.split(","):
            d = d.strip()
            if d and d not in device_ids:
                device_ids.append(d)

    # Convert to UTC boundaries
    start_wib = datetime.datetime.combine(start_date, datetime.time.min, tzinfo=WIB)
    # end_date is inclusive: end boundary is beginning of (end_date + 1 day)
    end_wib = datetime.datetime.combine(end_date + datetime.timedelta(days=1), datetime.time.min, tzinfo=WIB)

    start_utc = start_wib.astimezone(datetime.timezone.utc)
    end_utc = end_wib.astimezone(datetime.timezone.utc)

    return {
        "start_date": start_date,
        "end_date": end_date,
        "device_ids": device_ids,
        "start_utc": start_utc,
        "end_utc": end_utc,
        "start_wib": start_wib,
        "end_wib": end_wib,
    }


def get_cached_or_compute(cache_prefix: str, params: dict, compute_fn, extra_key: str = "", timeout: int = 60):
    dev_key = "_".join(sorted(params["device_ids"])) if params.get("device_ids") else "all"
    start_k = params.get("start_date", "")
    end_k = params.get("end_date", "")
    cache_key = f"anl:{cache_prefix}:{start_k}:{end_k}:{dev_key}:{extra_key}"
    data = cache.get(cache_key)
    if data is not None:
        return data
    data = compute_fn()
    cache.set(cache_key, data, timeout)
    return data


# --- 1. Summary ----------------------------------------------------------------------------------
def compute_summary(params):
    device_ids = params["device_ids"]
    start_utc = params["start_utc"]
    end_utc = params["end_utc"]

    devices_qs = Device.objects.all()
    if device_ids:
        devices_qs = devices_qs.filter(device_id__in=device_ids)
    devices = list(devices_qs.order_by("name"))

    perangkat_total = len(devices)
    perangkat_online = sum(1 for d in devices if d.is_online)
    lokasi = [format_location(d) for d in devices]

    alerts_qs = AlertLog.objects.filter(created_at__gte=start_utc, created_at__lt=end_utc)
    if device_ids:
        alerts_qs = alerts_qs.filter(device__device_id__in=device_ids)

    total_alert = alerts_qs.count()
    alert_terbuka = alerts_qs.filter(is_resolved=False).count()
    selesai = total_alert - alert_terbuka
    persen_selesai = round((selesai / total_alert * 100), 1) if total_alert > 0 else 0.0

    total_pengulangan = alerts_qs.aggregate(s=Sum("occurrences"))["s"] or 0

    # Incident duration: last_occurred_at - created_at (in minutes)
    durations = [
        (last - created).total_seconds() / 60.0
        for created, last in alerts_qs.values_list("created_at", "last_occurred_at")
    ]
    rata2_durasi_insiden_menit = round(statistics.mean(durations), 1) if durations else None

    # Time to resolve: resolved_at - created_at (in minutes)
    resolve_times = [
        (res - created).total_seconds() / 60.0
        for created, res in alerts_qs.filter(is_resolved=True, resolved_at__isnull=False).values_list(
            "created_at", "resolved_at"
        )
    ]
    median_waktu_penanganan_menit = round(statistics.median(resolve_times), 1) if resolve_times else None

    return {
        "total_alert": total_alert,
        "alert_terbuka": alert_terbuka,
        "persen_selesai": persen_selesai,
        "median_waktu_penanganan_menit": median_waktu_penanganan_menit,
        "rata2_durasi_insiden_menit": rata2_durasi_insiden_menit,
        "total_pengulangan": total_pengulangan,
        "perangkat_total": perangkat_total,
        "perangkat_online": perangkat_online,
        "lokasi": lokasi,
    }


# --- 2. Alerts Daily -----------------------------------------------------------------------------
def compute_alerts_daily(params):
    start_date = params["start_date"]
    end_date = params["end_date"]
    device_ids = params["device_ids"]
    start_utc = params["start_utc"]
    end_utc = params["end_utc"]

    devices_qs = Device.objects.all()
    if device_ids:
        devices_qs = devices_qs.filter(device_id__in=device_ids)
    devices = list(devices_qs.order_by("name"))

    # Mapping grid: tanggal -> device_id -> {alert, terselesaikan}
    grid = {}
    curr = start_date
    while curr <= end_date:
        d_str = curr.strftime("%Y-%m-%d")
        for dev in devices:
            grid[(d_str, dev.device_id)] = {
                "tanggal": d_str,
                "lokasi": dev.name,
                "device_id": dev.device_id,
                "alert": 0,
                "terselesaikan": 0,
            }
        curr += datetime.timedelta(days=1)

    alerts_qs = AlertLog.objects.filter(created_at__gte=start_utc, created_at__lt=end_utc)
    if device_ids:
        alerts_qs = alerts_qs.filter(device__device_id__in=device_ids)

    for dev_id, created_at, is_resolved in alerts_qs.values_list("device__device_id", "created_at", "is_resolved"):
        wib_date = created_at.astimezone(WIB).strftime("%Y-%m-%d")
        key = (wib_date, dev_id)
        if key in grid:
            grid[key]["alert"] += 1
            if is_resolved:
                grid[key]["terselesaikan"] += 1

    return list(grid.values())


# --- 3. Alerts By Location -----------------------------------------------------------------------
def compute_alerts_by_location(params):
    device_ids = params["device_ids"]
    start_utc = params["start_utc"]
    end_utc = params["end_utc"]

    devices_qs = Device.objects.all()
    if device_ids:
        devices_qs = devices_qs.filter(device_id__in=device_ids)
    devices = list(devices_qs.order_by("name"))

    alerts_qs = AlertLog.objects.filter(created_at__gte=start_utc, created_at__lt=end_utc)
    if device_ids:
        alerts_qs = alerts_qs.filter(device__device_id__in=device_ids)

    # Collect per device
    dev_data = {
        d.device_id: {
            "device": d,
            "alert": 0,
            "terbuka": 0,
            "pengulangan": 0,
            "resolve_times": [],
            "hour_counts": [0] * 24,
        }
        for d in devices
    }

    for dev_id, created_at, is_resolved, resolved_at, occurrences in alerts_qs.values_list(
        "device__device_id", "created_at", "is_resolved", "resolved_at", "occurrences"
    ):
        if dev_id not in dev_data:
            continue
        entry = dev_data[dev_id]
        entry["alert"] += 1
        if not is_resolved:
            entry["terbuka"] += 1
        entry["pengulangan"] += occurrences or 1
        if is_resolved and resolved_at:
            entry["resolve_times"].append((resolved_at - created_at).total_seconds() / 60.0)
        h = created_at.astimezone(WIB).hour
        entry["hour_counts"][h] += 1

    results = []
    for d in devices:
        e = dev_data[d.device_id]
        loc = format_location(d)
        max_h_count = max(e["hour_counts"]) if e["hour_counts"] else 0
        jam_puncak = e["hour_counts"].index(max_h_count) if max_h_count > 0 else None
        median_penanganan = round(statistics.median(e["resolve_times"]), 1) if e["resolve_times"] else None

        results.append({
            "device_id": d.device_id,
            "lokasi": loc["lokasi"],
            "koordinat": loc["koordinat"],
            "latitude": loc["latitude"],
            "longitude": loc["longitude"],
            "alert": e["alert"],
            "terbuka": e["terbuka"],
            "pengulangan": e["pengulangan"],
            "median_penanganan_menit": median_penanganan,
            "jam_puncak": jam_puncak,
        })
    return results


# --- 4. Alerts Heatmap ---------------------------------------------------------------------------
def compute_alerts_heatmap(params):
    device_ids = params["device_ids"]
    start_utc = params["start_utc"]
    end_utc = params["end_utc"]

    devices_qs = Device.objects.all()
    if device_ids:
        devices_qs = devices_qs.filter(device_id__in=device_ids)
    devices = list(devices_qs.order_by("name"))

    hari_jam = [[0 for _ in range(24)] for _ in range(7)]
    lokasi_jam_dict = {
        d.device_id: {
            **format_location(d),
            "jam": [0] * 24,
        }
        for d in devices
    }

    alerts_qs = AlertLog.objects.filter(created_at__gte=start_utc, created_at__lt=end_utc)
    if device_ids:
        alerts_qs = alerts_qs.filter(device__device_id__in=device_ids)

    for dev_id, created_at in alerts_qs.values_list("device__device_id", "created_at"):
        dt_wib = created_at.astimezone(WIB)
        day = dt_wib.weekday()  # Senin = 0, Minggu = 6
        hour = dt_wib.hour
        hari_jam[day][hour] += 1
        if dev_id in lokasi_jam_dict:
            lokasi_jam_dict[dev_id]["jam"][hour] += 1

    return {
        "hari_jam": hari_jam,
        "lokasi_jam": list(lokasi_jam_dict.values()),
    }


# --- 5. Alerts By Unit ---------------------------------------------------------------------------
def compute_alerts_by_unit(params):
    device_ids = params["device_ids"]
    start_utc = params["start_utc"]
    end_utc = params["end_utc"]

    devices_qs = Device.objects.all()
    if device_ids:
        devices_qs = devices_qs.filter(device_id__in=device_ids)
    dev_map = {d.device_id: d for d in devices_qs}

    alerts_qs = AlertLog.objects.filter(created_at__gte=start_utc, created_at__lt=end_utc)
    if device_ids:
        alerts_qs = alerts_qs.filter(device__device_id__in=device_ids)

    grouped = (
        alerts_qs.values("device__device_id", "unit_id")
        .annotate(alert=Count("id"), pengulangan=Sum("occurrences"))
        .order_by("-alert")
    )

    results = []
    for row in grouped:
        dev_id = row["device__device_id"]
        dev = dev_map.get(dev_id)
        if not dev:
            continue
        loc = format_location(dev)
        results.append({
            "lokasi": loc["lokasi"],
            "koordinat": loc["koordinat"],
            "latitude": loc["latitude"],
            "longitude": loc["longitude"],
            "unit_id": row["unit_id"],
            "alert": row["alert"],
            "pengulangan": row["pengulangan"] or row["alert"],
        })
    return results


# --- 6. Alerts By Type ---------------------------------------------------------------------------
def compute_alerts_by_type(params):
    device_ids = params["device_ids"]
    start_utc = params["start_utc"]
    end_utc = params["end_utc"]

    alerts_qs = AlertLog.objects.filter(created_at__gte=start_utc, created_at__lt=end_utc)
    if device_ids:
        alerts_qs = alerts_qs.filter(device__device_id__in=device_ids)

    grouped = (
        alerts_qs.values("alert_type", "event_name")
        .annotate(jumlah=Count("id"))
        .order_by("-jumlah")
    )
    return list(grouped)


# --- 7. Alerts Duration Histogram ----------------------------------------------------------------
def compute_alerts_duration(params):
    device_ids = params["device_ids"]
    start_utc = params["start_utc"]
    end_utc = params["end_utc"]

    devices_qs = Device.objects.all()
    if device_ids:
        devices_qs = devices_qs.filter(device_id__in=device_ids)
    devices = list(devices_qs.order_by("name"))

    alerts_qs = AlertLog.objects.filter(created_at__gte=start_utc, created_at__lt=end_utc)
    if device_ids:
        alerts_qs = alerts_qs.filter(device__device_id__in=device_ids)

    # Bins: 0-5, 5-15, 15-30, 30-60, >60 menit
    bins = [
        {"dari": 0, "sampai": 5, "jumlah": 0},
        {"dari": 5, "sampai": 15, "jumlah": 0},
        {"dari": 15, "sampai": 30, "jumlah": 0},
        {"dari": 30, "sampai": 60, "jumlah": 0},
        {"dari": 60, "sampai": None, "jumlah": 0},
    ]

    per_loc = {d.device_id: {"device": d, "durations": []} for d in devices}

    for dev_id, created_at, last_occurred_at in alerts_qs.values_list(
        "device__device_id", "created_at", "last_occurred_at"
    ):
        dur = max(0.0, (last_occurred_at - created_at).total_seconds() / 60.0)
        if dur <= 5:
            bins[0]["jumlah"] += 1
        elif dur <= 15:
            bins[1]["jumlah"] += 1
        elif dur <= 30:
            bins[2]["jumlah"] += 1
        elif dur <= 60:
            bins[3]["jumlah"] += 1
        else:
            bins[4]["jumlah"] += 1

        if dev_id in per_loc:
            per_loc[dev_id]["durations"].append(dur)

    per_lokasi_res = []
    for d in devices:
        loc = format_location(d)
        durs = per_loc[d.device_id]["durations"]
        per_lokasi_res.append({
            "lokasi": loc["lokasi"],
            "koordinat": loc["koordinat"],
            "latitude": loc["latitude"],
            "longitude": loc["longitude"],
            "rata2_menit": round(statistics.mean(durs), 1) if durs else None,
            "median_menit": round(statistics.median(durs), 1) if durs else None,
            "maks_menit": round(max(durs), 1) if durs else None,
        })

    return {
        "bins": bins,
        "per_lokasi": per_lokasi_res,
    }


# --- 8. Alerts Table & CSV -----------------------------------------------------------------------
def get_alerts_table_qs(params, status_filter: str = "semua"):
    device_ids = params["device_ids"]
    start_utc = params["start_utc"]
    end_utc = params["end_utc"]

    alerts_qs = (
        AlertLog.objects.select_related("device", "resolved_by")
        .filter(created_at__gte=start_utc, created_at__lt=end_utc)
        .order_by("-created_at")
    )
    if device_ids:
        alerts_qs = alerts_qs.filter(device__device_id__in=device_ids)

    if status_filter == "terbuka":
        alerts_qs = alerts_qs.filter(is_resolved=False)
    elif status_filter == "selesai":
        alerts_qs = alerts_qs.filter(is_resolved=True)

    return alerts_qs


def serialize_alert_row(alert: AlertLog) -> dict:
    durasi_menit = max(0.0, (alert.last_occurred_at - alert.created_at).total_seconds() / 60.0)
    waktu_penanganan_menit = (
        (alert.resolved_at - alert.created_at).total_seconds() / 60.0
        if (alert.is_resolved and alert.resolved_at)
        else None
    )
    loc = format_location(alert.device)
    resolved_by_name = (
        alert.resolved_by.get_full_name() or alert.resolved_by.username
        if alert.resolved_by
        else None
    )

    return {
        "id": alert.id,
        "created_at": alert.created_at.astimezone(WIB).isoformat(),
        "lokasi": loc["lokasi"],
        "koordinat": loc["koordinat"],
        "latitude": loc["latitude"],
        "longitude": loc["longitude"],
        "unit_id": alert.unit_id,
        "alert_type": alert.alert_type,
        "event_name": alert.event_name,
        "occurrences": alert.occurrences,
        "durasi_menit": round(durasi_menit, 1),
        "is_resolved": alert.is_resolved,
        "resolved_by": resolved_by_name,
        "waktu_penanganan_menit": round(waktu_penanganan_menit, 1) if waktu_penanganan_menit is not None else None,
    }


def generate_alerts_csv(alerts_qs):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Waktu Dibuat (WIB)",
        "Lokasi",
        "Koordinat",
        "Unit Sensor",
        "Jenis Alert",
        "Nama Kejadian",
        "Pengulangan",
        "Durasi (Menit)",
        "Status",
        "Ditangani Oleh",
        "Waktu Penanganan (Menit)",
    ])
    for alert in alerts_qs.iterator(chunk_size=1000):
        row = serialize_alert_row(alert)
        writer.writerow([
            row["created_at"],
            row["lokasi"],
            row["koordinat"],
            f"Unit {row['unit_id']}",
            row["alert_type"],
            row["event_name"],
            row["occurrences"],
            row["durasi_menit"],
            "Selesai" if row["is_resolved"] else "Terbuka",
            row["resolved_by"] or "-",
            row["waktu_penanganan_menit"] if row["waktu_penanganan_menit"] is not None else "-",
        ])
    return output.getvalue()


# --- 9. Telemetry By Location --------------------------------------------------------------------
def compute_telemetry_by_location(params):
    device_ids = params["device_ids"]
    start_utc = params["start_utc"]
    end_utc = params["end_utc"]
    interval_s = get_telemetry_interval()
    expected_per_hour = 3600.0 / interval_s

    devices_qs = Device.objects.all()
    if device_ids:
        devices_qs = devices_qs.filter(device_id__in=device_ids)
    devices = list(devices_qs.order_by("name"))

    tel_qs = TelemetryLog.objects.filter(created_at__gte=start_utc, created_at__lt=end_utc)
    if device_ids:
        tel_qs = tel_qs.filter(device__device_id__in=device_ids)

    # Aggregasi data per perangkat
    loc_stats = {
        d.device_id: {
            "device": d,
            "bacaan": 0,
            "no_echo": 0,
            "confirmed": 0,
            "distances": [],
            "hourly_counts": {},  # (unit_id, hour_str) -> count
        }
        for d in devices
    }

    fields = ("device__device_id", "unit_id", "distance_cm", "detection_state", "created_at")
    for dev_id, unit_id, dist, state, created_at in tel_qs.values_list(*fields).iterator(chunk_size=5000):
        if dev_id not in loc_stats:
            continue
        entry = loc_stats[dev_id]
        entry["bacaan"] += 1
        if dist is None:
            entry["no_echo"] += 1
        else:
            entry["distances"].append(dist)
        if state == "confirmed":
            entry["confirmed"] += 1

        hour_key = (unit_id, created_at.astimezone(WIB).strftime("%Y-%m-%d %H:00"))
        entry["hourly_counts"][hour_key] = entry["hourly_counts"].get(hour_key, 0) + 1

    results = []
    for d in devices:
        loc = format_location(d)
        entry = loc_stats[d.device_id]
        total_bacaan = entry["bacaan"]

        if total_bacaan == 0:
            results.append({
                "lokasi": loc["lokasi"],
                "koordinat": loc["koordinat"],
                "latitude": loc["latitude"],
                "longitude": loc["longitude"],
                "bacaan": 0,
                "kelengkapan_persen": 0.0,
                "persen_tanpa_echo": 0.0,
                "jarak_median_cm": None,
                "persen_confirmed": 0.0,
            })
            continue

        # Hitung kelengkapan: bacaan / expected per jam per unit, maks 100%, dirata-rata
        hourly_coverages = [
            min(100.0, (cnt / expected_per_hour) * 100.0)
            for cnt in entry["hourly_counts"].values()
        ]
        kelengkapan_persen = round(statistics.mean(hourly_coverages), 1) if hourly_coverages else 0.0
        persen_tanpa_echo = round((entry["no_echo"] / total_bacaan) * 100.0, 1)
        persen_confirmed = round((entry["confirmed"] / total_bacaan) * 100.0, 1)
        jarak_median_cm = round(statistics.median(entry["distances"]), 1) if entry["distances"] else None

        results.append({
            "lokasi": loc["lokasi"],
            "koordinat": loc["koordinat"],
            "latitude": loc["latitude"],
            "longitude": loc["longitude"],
            "bacaan": total_bacaan,
            "kelengkapan_persen": kelengkapan_persen,
            "persen_tanpa_echo": persen_tanpa_echo,
            "jarak_median_cm": jarak_median_cm,
            "persen_confirmed": persen_confirmed,
        })
    return results


# --- 10. Telemetry Coverage ----------------------------------------------------------------------
def compute_telemetry_coverage(params):
    device_ids = params["device_ids"]
    start_utc = params["start_utc"]
    end_utc = params["end_utc"]
    interval_s = get_telemetry_interval()
    expected_per_hour = 3600.0 / interval_s

    devices_qs = Device.objects.all()
    if device_ids:
        devices_qs = devices_qs.filter(device_id__in=device_ids)
    dev_names = {d.device_id: d.name for d in devices_qs}

    tel_qs = TelemetryLog.objects.filter(created_at__gte=start_utc, created_at__lt=end_utc)
    if device_ids:
        tel_qs = tel_qs.filter(device__device_id__in=device_ids)

    # Group counts per (hour_str, dev_id, unit_id)
    counts = {}
    fields = ("device__device_id", "unit_id", "created_at")
    for dev_id, unit_id, created_at in tel_qs.values_list(*fields).iterator(chunk_size=5000):
        dt_hour = created_at.astimezone(WIB).replace(minute=0, second=0, microsecond=0)
        key = (dt_hour, dev_id, unit_id)
        counts[key] = counts.get(key, 0) + 1

    results = []
    for (dt_hour, dev_id, unit_id), cnt in sorted(counts.items(), key=lambda x: x[0][0]):
        lokasi = dev_names.get(dev_id, dev_id)
        unit_label = f"{lokasi} / unit {unit_id}"
        kelengkapan_persen = round(min(100.0, (cnt / expected_per_hour) * 100.0), 1)
        results.append({
            "jam": dt_hour.isoformat(),
            "unit_label": unit_label,
            "lokasi": lokasi,
            "kelengkapan_persen": kelengkapan_persen,
        })
    return results


# --- 11. Telemetry State Mix ---------------------------------------------------------------------
def compute_telemetry_state_mix(params):
    device_ids = params["device_ids"]
    start_utc = params["start_utc"]
    end_utc = params["end_utc"]

    devices_qs = Device.objects.all()
    if device_ids:
        devices_qs = devices_qs.filter(device_id__in=device_ids)
    dev_names = {d.device_id: d.name for d in devices_qs}

    tel_qs = TelemetryLog.objects.filter(created_at__gte=start_utc, created_at__lt=end_utc)
    if device_ids:
        tel_qs = tel_qs.filter(device__device_id__in=device_ids)

    # Group count by (dev_id, unit_id, detection_state)
    counts = {}
    totals_per_unit = {}
    fields = ("device__device_id", "unit_id", "detection_state")
    for dev_id, unit_id, state in tel_qs.values_list(*fields).iterator(chunk_size=5000):
        state = state or "unknown"
        key = (dev_id, unit_id, state)
        unit_key = (dev_id, unit_id)
        counts[key] = counts.get(key, 0) + 1
        totals_per_unit[unit_key] = totals_per_unit.get(unit_key, 0) + 1

    results = []
    for (dev_id, unit_id, state), count in sorted(counts.items(), key=lambda x: (x[0][0], x[0][1], -x[1])):
        lokasi = dev_names.get(dev_id, dev_id)
        unit_label = f"{lokasi} / unit {unit_id}"
        total = totals_per_unit.get((dev_id, unit_id), 1)
        persen = round((count / total) * 100.0, 1)
        results.append({
            "unit_label": unit_label,
            "detection_state": state,
            "jumlah": count,
            "persen": persen,
        })
    return results


# --- 12. Telemetry Distance ----------------------------------------------------------------------
def compute_telemetry_distance(params, device_id: str, unit_id: int):
    start_utc = params["start_utc"]
    end_utc = params["end_utc"]

    device = Device.objects.filter(device_id=device_id).first()
    if not device:
        # Fallback to first device
        device = Device.objects.first()
    if not device:
        return {"device_id": None, "unit_id": unit_id, "unit_label": "-", "tolerant_distance_cm": None, "data": []}

    dev_id = device.device_id
    unit_label = f"{device.name} / unit {unit_id}"
    tolerant_distance_cm = device.tolerant_distance_cm

    tel_qs = (
        TelemetryLog.objects.filter(
            device=device,
            unit_id=unit_id,
            created_at__gte=start_utc,
            created_at__lt=end_utc,
            distance_cm__isnull=False,
        )
        .order_by("created_at")
        .values_list("created_at", "distance_cm")
    )

    # Group and average per minute
    minute_buckets = {}
    for created_at, dist in tel_qs.iterator(chunk_size=5000):
        m_dt = created_at.astimezone(WIB).replace(second=0, microsecond=0)
        if m_dt not in minute_buckets:
            minute_buckets[m_dt] = []
        minute_buckets[m_dt].append(dist)

    sorted_minutes = sorted(minute_buckets.keys())
    # Max ~2000 points downsample
    step = max(1, math.ceil(len(sorted_minutes) / 2000))
    data = []
    for i in range(0, len(sorted_minutes), step):
        m_dt = sorted_minutes[i]
        dists = minute_buckets[m_dt]
        avg_dist = round(statistics.mean(dists), 1)
        data.append({
            "waktu": m_dt.isoformat(),
            "distance_cm": avg_dist,
        })

    return {
        "device_id": dev_id,
        "unit_id": unit_id,
        "unit_label": unit_label,
        "tolerant_distance_cm": tolerant_distance_cm,
        "data": data,
    }


# --- 13. Telemetry Gaps --------------------------------------------------------------------------
def compute_telemetry_gaps(params):
    device_ids = params["device_ids"]
    start_utc = params["start_utc"]
    end_utc = params["end_utc"]
    interval_s = get_telemetry_interval()
    min_gap_seconds = interval_s * 6  # 30 detik untuk interval 5s

    devices_qs = Device.objects.all()
    if device_ids:
        devices_qs = devices_qs.filter(device_id__in=device_ids)
    dev_map = {d.device_id: d for d in devices_qs}

    tel_qs = TelemetryLog.objects.filter(created_at__gte=start_utc, created_at__lt=end_utc)
    if device_ids:
        tel_qs = tel_qs.filter(device__device_id__in=device_ids)

    # Sort and check timestamps per unit
    unit_timestamps = {}
    fields = ("device__device_id", "unit_id", "created_at")
    for dev_id, unit_id, created_at in tel_qs.order_by("created_at").values_list(*fields).iterator(chunk_size=5000):
        key = (dev_id, unit_id)
        if key not in unit_timestamps:
            unit_timestamps[key] = []
        unit_timestamps[key].append(created_at)

    gaps = []
    for (dev_id, unit_id), ts_list in unit_timestamps.items():
        dev = dev_map.get(dev_id)
        if not dev:
            continue
        loc = format_location(dev)
        unit_label = f"{loc['lokasi']} / unit {unit_id}"

        for i in range(1, len(ts_list)):
            prev_t = ts_list[i - 1]
            curr_t = ts_list[i]
            diff_s = (curr_t - prev_t).total_seconds()
            if diff_s > min_gap_seconds:
                gaps.append({
                    "unit_label": unit_label,
                    "lokasi": loc["lokasi"],
                    "koordinat": loc["koordinat"],
                    "latitude": loc["latitude"],
                    "longitude": loc["longitude"],
                    "mulai": prev_t.astimezone(WIB).isoformat(),
                    "selesai": curr_t.astimezone(WIB).isoformat(),
                    "durasi_menit": round(diff_s / 60.0, 1),
                })

    gaps.sort(key=lambda g: g["durasi_menit"], reverse=True)
    return gaps
