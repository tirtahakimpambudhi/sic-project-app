"""Lapisan data: SQL -> DataFrame lewat pandas.read_sql (SQLAlchemy). Tidak ada ketergantungan Django.

Nama tabel mengikuti konvensi Django backend: devices_device, devices_deviceunit,
devices_telemetrylog, devices_alertlog, accounts_user.

Waktu di database disimpan UTC (USE_TZ=True di backend). Di sini dikonversi ke zona waktu
lokal (default Asia/Jakarta) lalu dibuat naive agar pengelompokan per hari/jam sederhana.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote_plus

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import bindparam, create_engine, text
from sqlalchemy.engine import Engine

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

DEFAULT_MAX_TELEMETRY_ROWS = 300_000
_engine: Engine | None = None


def local_tz() -> str:
    return os.environ.get("TIMEZONE", "Asia/Jakarta")


def online_window_seconds() -> int:
    return int(os.environ.get("DEVICE_ONLINE_WINDOW_SECONDS", "20"))


def get_engine() -> Engine:
    """Engine tunggal (connection pool) dari DB_URL, atau dirakit dari DB_HOST/DB_USER/..."""
    global _engine
    if _engine is None:
        url = os.environ.get("DB_URL")
        if not url:
            url = "mysql+pymysql://{u}:{p}@{h}:{port}/{n}?charset=utf8mb4".format(
                u=quote_plus(os.environ.get("DB_USER", "slop")),
                p=quote_plus(os.environ.get("DB_PASSWORD", "")),
                h=os.environ.get("DB_HOST", "localhost"),
                port=os.environ.get("DB_PORT", "3306"),
                n=os.environ.get("DB_NAME", "slop"),
            )
        if url.startswith("sqlite:///") and not url.startswith("sqlite:////"):
            # Path SQLite relatif dihitung dari root project, bukan dari folder kerja notebook.
            url = "sqlite:///" + str((ROOT / url[len("sqlite:///"):]).resolve())
        _engine = create_engine(url, pool_pre_ping=True, pool_recycle=300)
    return _engine


def _localize(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    for col in cols:
        if col in df.columns:
            s = pd.to_datetime(df[col], errors="coerce")
            df[col] = s.dt.tz_localize("UTC").dt.tz_convert(local_tz()).dt.tz_localize(None)
    return df


def _to_utc(dt: datetime | None) -> datetime | None:
    """Batas waktu lokal (naive) -> UTC naive untuk dibandingkan dengan kolom di database."""
    if dt is None:
        return None
    return pd.Timestamp(dt).tz_localize(local_tz()).tz_convert("UTC").tz_localize(None).to_pydatetime()


def _where(start, end, device_ids, time_col: str, params: dict):
    clauses = []
    if start is not None:
        clauses.append(f"{time_col} >= :start")
        params["start"] = _to_utc(start)
    if end is not None:
        clauses.append(f"{time_col} < :end")
        params["end"] = _to_utc(end)
    if device_ids:
        clauses.append("d.device_id IN :dev_ids")
        params["dev_ids"] = list(device_ids)
    return (" WHERE " + " AND ".join(clauses)) if clauses else ""


def _read(sql: str, params: dict | None = None, expanding: list[str] | None = None) -> pd.DataFrame:
    stmt = text(sql)
    for name in expanding or []:
        stmt = stmt.bindparams(bindparam(name, expanding=True))
    with get_engine().connect() as conn:
        return pd.read_sql(stmt, conn, params=params or {})


# --- Perangkat -----------------------------------------------------------------------------------
def load_devices() -> pd.DataFrame:
    df = _read(
        """SELECT id, device_id, name, latitude, longitude, tolerant_distance_cm, timeout_seconds,
                  last_seen, last_operation, setup_result, created_at
           FROM devices_device ORDER BY name"""
    )
    if df.empty:
        return df
    df = _localize(df, ["last_seen", "created_at"])
    now = pd.Timestamp.now(tz=local_tz()).tz_localize(None)
    df["is_online"] = df["last_seen"].notna() & ((now - df["last_seen"]) <= timedelta(seconds=online_window_seconds()))
    df["label"] = df["name"] + " (" + df["device_id"].str.slice(0, 8) + ")"
    return df


def load_units() -> pd.DataFrame:
    df = _read(
        """SELECT d.device_id, d.name AS device_name, u.unit_id, u.is_default, u.has_setup,
                  u.trig_pin, u.echo_pin, u.servo_pin, u.buzzer_pin, u.detection_state,
                  u.is_object_detected, u.buzzer_active, u.last_distance_cm, u.servo_position, u.last_seen
           FROM devices_deviceunit u JOIN devices_device d ON d.id = u.device_id
           ORDER BY d.name, u.unit_id"""
    )
    return _localize(df, ["last_seen"]) if not df.empty else df


# --- Alert ---------------------------------------------------------------------------------------
def load_alerts(start=None, end=None, device_ids: list[str] | None = None) -> pd.DataFrame:
    params: dict = {}
    where = _where(start, end, device_ids, "a.created_at", params)
    df = _read(
        f"""SELECT a.id, d.device_id, d.name AS device_name, a.unit_id, a.event_name, a.alert_type,
                   a.message, a.distance_cm, a.latitude, a.longitude, a.occurrences, a.created_at,
                   a.last_occurred_at, a.released_at, a.is_resolved, a.resolved_at,
                   usr.username AS resolved_by
            FROM devices_alertlog a
            JOIN devices_device d ON d.id = a.device_id
            LEFT JOIN accounts_user usr ON usr.id = a.resolved_by_id
            {where}""",
        params, ["dev_ids"] if device_ids else None,
    )
    if df.empty:
        return df
    df = _localize(df, ["created_at", "last_occurred_at", "released_at", "resolved_at"])
    df["is_resolved"] = df["is_resolved"].astype(bool)
    df["unit_label"] = df["device_name"] + " / unit " + df["unit_id"].astype(str)
    # Lama insiden: dari alert pertama sampai pengulangan terakhir yang masuk.
    df["duration_min"] = (df["last_occurred_at"] - df["created_at"]).dt.total_seconds() / 60
    df["time_to_resolve_min"] = (df["resolved_at"] - df["created_at"]).dt.total_seconds() / 60
    df["time_to_release_min"] = (df["released_at"] - df["created_at"]).dt.total_seconds() / 60
    return df.sort_values("created_at").reset_index(drop=True)


# --- Telemetri -----------------------------------------------------------------------------------
def load_telemetry(
    start=None, end=None, device_ids: list[str] | None = None, max_rows: int = DEFAULT_MAX_TELEMETRY_ROWS
) -> pd.DataFrame:
    """Mengambil data TERBARU lebih dulu sampai `max_rows`; df.attrs['truncated'] menandai terpotong."""
    params: dict = {"limit": int(max_rows) + 1}
    where = _where(start, end, device_ids, "t.created_at", params)
    df = _read(
        f"""SELECT d.device_id, d.name AS device_name, t.unit_id, t.distance_cm, t.servo_position,
                   t.detection_state, t.created_at
            FROM devices_telemetrylog t
            JOIN devices_device d ON d.id = t.device_id
            {where}
            ORDER BY t.created_at DESC LIMIT :limit""",
        params, ["dev_ids"] if device_ids else None,
    )
    truncated = len(df) > max_rows
    df = df.iloc[:max_rows].copy()
    if not df.empty:
        df = _localize(df, ["created_at"])
        df["unit_label"] = df["device_name"] + " / unit " + df["unit_id"].astype(str)
        df = df.sort_values("created_at").reset_index(drop=True)
    df.attrs["truncated"] = truncated
    return df


def data_bounds() -> dict:
    """Rentang waktu data yang tersedia, untuk nilai awal filter tanggal."""
    a = _read("SELECT MIN(created_at) AS lo, MAX(created_at) AS hi FROM devices_alertlog").iloc[0]
    t = _read("SELECT MIN(created_at) AS lo, MAX(created_at) AS hi FROM devices_telemetrylog").iloc[0]

    def conv(v):
        if pd.isna(v):
            return None
        return pd.Timestamp(v).tz_localize("UTC").tz_convert(local_tz()).tz_localize(None).to_pydatetime()

    return {"alert_min": conv(a["lo"]), "alert_max": conv(a["hi"]),
            "telemetry_min": conv(t["lo"]), "telemetry_max": conv(t["hi"])}


def table_counts() -> pd.Series:
    out = {}
    for t in ("devices_device", "devices_deviceunit", "devices_telemetrylog", "devices_alertlog"):
        out[t] = int(_read(f"SELECT COUNT(*) AS n FROM {t}")["n"].iloc[0])
    return pd.Series(out, name="baris")
