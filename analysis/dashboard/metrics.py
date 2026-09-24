"""Perhitungan metrik murni pandas (tanpa akses database) sehingga mudah diuji."""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

HARI = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]


def telemetry_interval_seconds() -> float:
    return float(os.environ.get("TELEMETRY_INTERVAL_SECONDS", "5"))


def kpis(alerts: pd.DataFrame, devices: pd.DataFrame) -> dict:
    total = len(alerts)
    resolved = int(alerts["is_resolved"].sum()) if total else 0
    return {
        "total_alert": total,
        "alert_terbuka": total - resolved,
        "persen_selesai": (resolved / total * 100) if total else 0.0,
        "median_waktu_selesai_min": alerts["time_to_resolve_min"].median() if total else np.nan,
        "rata2_durasi_insiden_min": alerts["duration_min"].mean() if total else np.nan,
        "total_pengulangan": int(alerts["occurrences"].sum()) if total else 0,
        "perangkat_total": len(devices),
        "perangkat_online": int(devices["is_online"].sum()) if len(devices) else 0,
    }


def alerts_per_day(alerts: pd.DataFrame) -> pd.DataFrame:
    if alerts.empty:
        return pd.DataFrame(columns=["tanggal", "alert", "terselesaikan"])
    d = alerts.assign(tanggal=alerts["created_at"].dt.normalize())
    out = d.groupby("tanggal").agg(alert=("id", "count"), terselesaikan=("is_resolved", "sum")).reset_index()
    full = pd.date_range(out["tanggal"].min(), out["tanggal"].max(), freq="D")
    return out.set_index("tanggal").reindex(full, fill_value=0).rename_axis("tanggal").reset_index()


def alert_heatmap(alerts: pd.DataFrame) -> pd.DataFrame:
    """Matriks hari (baris) x jam (kolom), nilai = jumlah alert."""
    grid = pd.DataFrame(0, index=HARI, columns=range(24))
    if alerts.empty:
        return grid
    c = alerts.assign(hari=alerts["created_at"].dt.dayofweek, jam=alerts["created_at"].dt.hour)
    counts = c.groupby(["hari", "jam"]).size()
    for (h, j), v in counts.items():
        grid.iloc[h, j] = v
    return grid


def alerts_by_unit(alerts: pd.DataFrame) -> pd.DataFrame:
    if alerts.empty:
        return pd.DataFrame(columns=["unit_label", "alert", "pengulangan"])
    return (
        alerts.groupby("unit_label")
        .agg(alert=("id", "count"), pengulangan=("occurrences", "sum"))
        .sort_values("alert", ascending=False)
        .reset_index()
    )


def alerts_by_type(alerts: pd.DataFrame) -> pd.DataFrame:
    if alerts.empty:
        return pd.DataFrame(columns=["alert_type", "event_name", "jumlah"])
    return alerts.groupby(["alert_type", "event_name"]).size().rename("jumlah").reset_index()


def alert_hotspots(alerts: pd.DataFrame) -> pd.DataFrame:
    """Titik lokasi alert (dibulatkan ~11 m) dengan jumlah kejadian."""
    d = alerts.dropna(subset=["latitude", "longitude"])
    if d.empty:
        return pd.DataFrame(columns=["latitude", "longitude", "alert", "device_name"])
    d = d.assign(latitude=d["latitude"].round(4), longitude=d["longitude"].round(4))
    return (
        d.groupby(["latitude", "longitude", "device_name"]).size().rename("alert").reset_index()
        .sort_values("alert", ascending=False)
    )


def telemetry_hourly(tel: pd.DataFrame) -> pd.DataFrame:
    """Ringkasan per jam per unit: jumlah bacaan, jarak rata-rata, porsi state 'confirmed'."""
    if tel.empty:
        return pd.DataFrame(columns=["jam", "unit_label", "bacaan", "jarak_rata2_cm", "persen_confirmed", "persen_tanpa_echo"])
    d = tel.assign(jam=tel["created_at"].dt.floor("h"))
    g = d.groupby(["jam", "unit_label"])
    out = g.agg(
        bacaan=("created_at", "size"),
        jarak_rata2_cm=("distance_cm", "mean"),
        persen_confirmed=("detection_state", lambda s: (s == "confirmed").mean() * 100),
        persen_tanpa_echo=("distance_cm", lambda s: s.isna().mean() * 100),
    ).reset_index()
    return out


def telemetry_coverage(tel: pd.DataFrame, interval_s: float | None = None) -> pd.DataFrame:
    """Kelengkapan data per jam: bacaan nyata dibanding yang seharusnya (3600/interval)."""
    interval_s = interval_s or telemetry_interval_seconds()
    h = telemetry_hourly(tel)
    if h.empty:
        return h.assign(kelengkapan_persen=[])
    expected = 3600 / interval_s
    h["kelengkapan_persen"] = (h["bacaan"] / expected * 100).clip(upper=100)
    return h


def state_mix(tel: pd.DataFrame) -> pd.DataFrame:
    if tel.empty:
        return pd.DataFrame(columns=["unit_label", "detection_state", "jumlah", "persen"])
    m = tel.groupby(["unit_label", "detection_state"]).size().rename("jumlah").reset_index()
    m["persen"] = m["jumlah"] / m.groupby("unit_label")["jumlah"].transform("sum") * 100
    return m


def gaps(tel: pd.DataFrame, min_gap_s: float | None = None) -> pd.DataFrame:
    """Celah data (perangkat diduga offline): selisih antar bacaan > min_gap_s per unit."""
    min_gap_s = min_gap_s or telemetry_interval_seconds() * 6
    if tel.empty:
        return pd.DataFrame(columns=["unit_label", "mulai", "selesai", "durasi_menit"])
    parts = []
    for unit, d in tel.groupby("unit_label"):
        t = d["created_at"].sort_values()
        diff = t.diff().dt.total_seconds()
        idx = diff[diff > min_gap_s].index
        for i in idx:
            parts.append({"unit_label": unit, "mulai": t.shift(1)[i], "selesai": t[i], "durasi_menit": diff[i] / 60})
    return pd.DataFrame(parts, columns=["unit_label", "mulai", "selesai", "durasi_menit"]).sort_values("durasi_menit", ascending=False)
