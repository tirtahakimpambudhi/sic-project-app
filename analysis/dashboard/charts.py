"""Figur Plotly. Setiap fungsi menerima DataFrame hasil metrics.py dan mengembalikan Figure."""
from __future__ import annotations

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

_LAYOUT = dict(margin=dict(l=10, r=10, t=40, b=10), legend=dict(orientation="h", y=-0.2))


def _empty(title: str) -> go.Figure:
    fig = go.Figure()
    fig.update_layout(title=title, annotations=[dict(text="Tidak ada data pada filter ini", showarrow=False, x=0.5, y=0.5, xref="paper", yref="paper")], **_LAYOUT)
    return fig


def fig_alerts_per_day(df: pd.DataFrame) -> go.Figure:
    if df.empty:
        return _empty("Alert per hari")
    fig = go.Figure()
    fig.add_bar(x=df["tanggal"], y=df["alert"], name="Alert")
    fig.add_scatter(x=df["tanggal"], y=df["terselesaikan"], name="Terselesaikan", mode="lines+markers")
    fig.update_layout(title="Alert per hari", **_LAYOUT)
    return fig


def fig_heatmap(grid: pd.DataFrame) -> go.Figure:
    fig = px.imshow(
        grid.values, x=[f"{j:02d}" for j in grid.columns], y=list(grid.index),
        color_continuous_scale="YlOrRd", aspect="auto", labels=dict(x="Jam", y="Hari", color="Alert"),
    )
    fig.update_layout(title="Pola alert: hari x jam", **_LAYOUT)
    return fig


def fig_alerts_by_unit(df: pd.DataFrame) -> go.Figure:
    if df.empty:
        return _empty("Alert per unit")
    fig = px.bar(df, x="alert", y="unit_label", orientation="h", hover_data=["pengulangan"], title="Alert per unit")
    fig.update_layout(yaxis=dict(autorange="reversed"), **_LAYOUT)
    return fig


def fig_alerts_by_type(df: pd.DataFrame) -> go.Figure:
    if df.empty:
        return _empty("Jenis alert")
    fig = px.pie(df, names="event_name", values="jumlah", hole=0.5, title="Jenis alert")
    fig.update_layout(**_LAYOUT)
    return fig


def fig_duration_hist(alerts: pd.DataFrame) -> go.Figure:
    if alerts.empty:
        return _empty("Lama insiden")
    fig = px.histogram(alerts, x="duration_min", nbins=30, title="Distribusi lama insiden (menit)")
    fig.update_layout(**_LAYOUT)
    return fig



def fig_distance(tel: pd.DataFrame, tolerant_cm: float | None = None) -> go.Figure:
    if tel.empty:
        return _empty("Jarak sensor")
    fig = px.line(tel, x="created_at", y="distance_cm", color="unit_label", title="Jarak sensor (cm)")
    if tolerant_cm:
        fig.add_hline(y=tolerant_cm, line_dash="dash", annotation_text="Batas toleransi")
    fig.update_layout(**_LAYOUT)
    return fig


def fig_confirmed_share(h: pd.DataFrame) -> go.Figure:
    if h.empty:
        return _empty("Porsi state confirmed")
    fig = px.line(h, x="jam", y="persen_confirmed", color="unit_label", title="Porsi bacaan state 'confirmed' per jam (%)")
    fig.update_layout(**_LAYOUT)
    return fig


def fig_state_mix(m: pd.DataFrame) -> go.Figure:
    if m.empty:
        return _empty("Komposisi state")
    fig = px.bar(m, x="unit_label", y="persen", color="detection_state", title="Komposisi state deteksi (%)")
    fig.update_layout(**_LAYOUT)
    return fig


def fig_coverage(h: pd.DataFrame) -> go.Figure:
    if h.empty:
        return _empty("Kelengkapan data telemetri")
    pivot = h.pivot(index="unit_label", columns="jam", values="kelengkapan_persen")
    fig = px.imshow(pivot.values, x=pivot.columns, y=list(pivot.index), color_continuous_scale="Blues", zmin=0, zmax=100, aspect="auto", labels=dict(color="%"))
    fig.update_layout(title="Kelengkapan data telemetri per jam (%)", **_LAYOUT)
    return fig
