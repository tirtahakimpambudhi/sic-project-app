"""Dashboard analitik (Streamlit). Jalankan: streamlit run app.py"""
from datetime import date, datetime, time, timedelta

import pandas as pd
import streamlit as st

from dashboard import charts, data, metrics

st.set_page_config(page_title="Analytics", page_icon="🅿️", layout="wide")


# --- Cache: query database hanya sekali per kombinasi filter selama TTL ------------------------
@st.cache_data(ttl=60, show_spinner="Memuat perangkat...")
def get_devices():
    return data.load_devices()


@st.cache_data(ttl=60, show_spinner="Memuat alert...")
def get_alerts(start, end, device_ids):
    return data.load_alerts(start, end, list(device_ids) or None)


@st.cache_data(ttl=60, show_spinner="Memuat telemetri...")
def get_telemetry(start, end, device_ids, max_rows):
    df = data.load_telemetry(start, end, list(device_ids) or None, max_rows)
    return df, bool(df.attrs.get("truncated"))


@st.cache_data(ttl=300)
def get_bounds():
    return data.data_bounds()


# --- Sidebar -------------------------------------------------------------------------------------
devices = get_devices()
bounds = get_bounds()

st.sidebar.title("Filter")
hi = (bounds["alert_max"] or bounds["telemetry_max"] or datetime.now()).date()
rentang = st.sidebar.date_input("Rentang tanggal", value=(hi - timedelta(days=13), hi), max_value=date.today())
if isinstance(rentang, tuple) and len(rentang) == 2:
    d_start, d_end = rentang
else:
    d_start = d_end = rentang[0] if isinstance(rentang, tuple) else rentang
start = datetime.combine(d_start, time.min)
end = datetime.combine(d_end + timedelta(days=1), time.min)

pilihan = devices.set_index("device_id")["label"].to_dict() if not devices.empty else {}
dipilih = st.sidebar.multiselect("Perangkat", options=list(pilihan), format_func=pilihan.get, placeholder="Semua perangkat")
max_rows = st.sidebar.select_slider("Batas baris telemetri", [50_000, 100_000, 300_000, 600_000, 1_000_000], value=300_000)
if st.sidebar.button("Muat ulang data"):
    st.cache_data.clear()
    st.rerun()
st.sidebar.caption("Data di-cache 60 detik. Sumber: database backend (pandas.read_sql).")

# --- Data ----------------------------------------------------------------------------------------
dev_view = devices[devices["device_id"].isin(dipilih)] if dipilih and not devices.empty else devices
alerts = get_alerts(start, end, tuple(dipilih))
tel, truncated = get_telemetry(start, end, tuple(dipilih), max_rows)

st.title("🅿️ Analytics")
st.caption(f"Periode {d_start:%d %b %Y} – {d_end:%d %b %Y} · zona waktu Asia/Jakarta")

tab_ringkas, tab_alert, tab_tel, tab_dev = st.tabs(["Ringkasan", "Analisis Alert", "Telemetri & Kualitas Data", "Perangkat"])

# --- Ringkasan -----------------------------------------------------------------------------------
with tab_ringkas:
    k = metrics.kpis(alerts, dev_view)
    c = st.columns(5)
    c[0].metric("Total alert", f"{k['total_alert']:,}")
    c[1].metric("Alert terbuka", f"{k['alert_terbuka']:,}")
    c[2].metric("Terselesaikan", f"{k['persen_selesai']:.0f}%")
    med = k["median_waktu_selesai_min"]
    c[3].metric("Median waktu penanganan", "-" if pd.isna(med) else f"{med:.0f} mnt")
    c[4].metric("Perangkat online", f"{k['perangkat_online']}/{k['perangkat_total']}")
    l, r = st.columns([3, 2])
    l.plotly_chart(charts.fig_alerts_per_day(metrics.alerts_per_day(alerts)), width="stretch")
    r.plotly_chart(charts.fig_alerts_by_unit(metrics.alerts_by_unit(alerts)), width="stretch")
    st.plotly_chart(charts.fig_heatmap(metrics.alert_heatmap(alerts)), width="stretch")

# --- Alert ---------------------------------------------------------------------------------------
with tab_alert:
    l, r = st.columns(2)
    l.plotly_chart(charts.fig_alerts_by_type(metrics.alerts_by_type(alerts)), width="stretch")
    r.plotly_chart(charts.fig_duration_hist(alerts), width="stretch")
    st.subheader("Daftar alert")
    status = st.radio("Status", ["Semua", "Terbuka", "Selesai"], horizontal=True)
    tabel = alerts
    if status == "Terbuka":
        tabel = alerts[~alerts["is_resolved"]]
    elif status == "Selesai":
        tabel = alerts[alerts["is_resolved"]]
    cols = ["created_at", "unit_label", "alert_type", "event_name", "occurrences", "duration_min", "is_resolved", "resolved_by", "time_to_resolve_min"]
    st.dataframe(tabel[cols].sort_values("created_at", ascending=False) if not tabel.empty else tabel, width="stretch", hide_index=True)
    st.download_button("Unduh CSV", tabel.to_csv(index=False).encode(), "alert.csv", "text/csv", disabled=tabel.empty)

# --- Telemetri -----------------------------------------------------------------------------------
with tab_tel:
    if truncated:
        st.warning(f"Data telemetri melebihi {max_rows:,} baris; hanya data terbaru yang dimuat. Perkecil rentang tanggal atau naikkan batas di sidebar.")
    if tel.empty:
        st.info("Tidak ada telemetri pada filter ini.")
    else:
        h = metrics.telemetry_coverage(tel)
        c = st.columns(3)
        c[0].metric("Jumlah bacaan", f"{len(tel):,}")
        c[1].metric("Kelengkapan rata-rata", f"{h['kelengkapan_persen'].mean():.0f}%")
        c[2].metric("Bacaan tanpa echo", f"{tel['distance_cm'].isna().mean() * 100:.1f}%")
        st.plotly_chart(charts.fig_coverage(h), width="stretch")
        l, r = st.columns(2)
        l.plotly_chart(charts.fig_state_mix(metrics.state_mix(tel)), width="stretch")
        r.plotly_chart(charts.fig_confirmed_share(h), width="stretch")
        st.subheader("Jarak sensor")
        unit = st.selectbox("Unit", sorted(tel["unit_label"].unique()))
        sub = tel[tel["unit_label"] == unit]
        # Downsample untuk grafik: rata-rata per menit agar tetap ringan.
        mnt = sub.set_index("created_at")[["distance_cm"]].resample("1min").mean().dropna().reset_index()
        mnt["unit_label"] = unit
        tol = dev_view.set_index("label")["tolerant_distance_cm"].to_dict() if not dev_view.empty else {}
        st.plotly_chart(charts.fig_distance(mnt, tol.get(unit.split(" / unit")[0]) or None), width="stretch")
        st.subheader("Celah data (perangkat diduga offline)")
        g = metrics.gaps(tel)
        st.dataframe(g, width="stretch", hide_index=True)

# --- Perangkat -----------------------------------------------------------------------------------
with tab_dev:
    if devices.empty:
        st.info("Belum ada perangkat terdaftar.")
    else:
        st.dataframe(
            dev_view[["name", "device_id", "is_online", "last_seen", "tolerant_distance_cm", "timeout_seconds", "latitude", "longitude"]],
            width="stretch", hide_index=True,
        )
        units = data.load_units()
        st.subheader("Unit sensor")
        st.dataframe(units, width="stretch", hide_index=True)
