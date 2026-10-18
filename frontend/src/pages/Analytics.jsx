import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import Table from "../components/Table.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";
import FilterBar from "../components/analytics/FilterBar.jsx";
import KpiCard from "../components/analytics/KpiCard.jsx";
import ChartCard from "../components/analytics/ChartCard.jsx";
import useDevices from "../hooks/useDevices.js";
import analyticsApi from "../services/analyticsApi.js";
import { apiErrorMessage } from "../services/api.js";
import {
  formatLocationSubtitle,
  formatMinutes,
  formatNumber,
  formatPercent,
  formatWibDate,
  formatWibDateTime,
  getDatePreset,
} from "../utils/analytics.js";

// Chart palette resolving cleanly in both light and dark mode
const COLORS = [
  "#2563eb", // blue
  "#16a34a", // green
  "#ea580c", // orange
  "#9333ea", // purple
  "#0891b2", // cyan
  "#d97706", // amber
  "#dc2626", // red
];

export default function Analytics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { devices = [] } = useDevices(15000);

  // Initialize filters from URL or default to 14 days
  const filters = useMemo(() => {
    const defaultRange = getDatePreset(14);
    const start = searchParams.get("start") || defaultRange.start;
    const end = searchParams.get("end") || defaultRange.end;
    const devParam = searchParams.getAll("device");
    let device = [];
    if (devParam.length > 0) {
      device = devParam;
    } else if (searchParams.get("device")) {
      device = searchParams.get("device").split(",").filter(Boolean);
    }
    return { start, end, device };
  }, [searchParams]);

  // Filter change handler updates URL query params
  const handleFiltersChange = useCallback(
    (newFilters) => {
      const nextParams = new URLSearchParams();
      if (newFilters.start) nextParams.set("start", newFilters.start);
      if (newFilters.end) nextParams.set("end", newFilters.end);
      if (newFilters.device && newFilters.device.length > 0) {
        newFilters.device.forEach((d) => nextParams.append("device", d));
      }
      setSearchParams(nextParams, { replace: true });
    },
    [setSearchParams]
  );

  // Data states
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [summary, setSummary] = useState(null);
  const [alertsDaily, setAlertsDaily] = useState([]);
  const [alertsHourly, setAlertsHourly] = useState([]);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  // Fetch summary, daily, and hourly analytics
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      analyticsApi.getSummary(filters),
      analyticsApi.getAlertsDaily(filters),
      analyticsApi.getAlertsHourly(filters),
    ])
      .then(([sumRes, dailyRes, hourlyRes]) => {
        if (!active) return;
        setSummary(sumRes);
        setAlertsDaily(dailyRes || []);
        setAlertsHourly(hourlyRes || []);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(apiErrorMessage(err, "Gagal memuat data analitik. Silakan coba lagi."));
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filters, refreshKey]);

  // Fetch 50 most recent alerts from GET /api/alerts/
  useEffect(() => {
    let active = true;
    setRecentLoading(true);

    analyticsApi
      .getRecentAlerts(filters.device)
      .then((data) => {
        if (!active) return;
        setRecentAlerts(data || []);
        setRecentLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setRecentLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filters.device, refreshKey]);

  // Active locations list from summary
  const activeLocations = summary?.per_lokasi || [];

  // Map location name to coordinates for tooltips
  const locationCoordsMap = useMemo(() => {
    const map = {};
    (summary?.per_lokasi || []).forEach((item) => {
      map[item.lokasi] = item.koordinat;
    });
    return map;
  }, [summary]);

  // Transform alertsDaily for stacked bar chart: group by date
  const stackedDailyData = useMemo(() => {
    if (!alertsDaily || alertsDaily.length === 0) return [];
    const dateMap = {};
    alertsDaily.forEach((row) => {
      if (!dateMap[row.tanggal]) {
        dateMap[row.tanggal] = { tanggal: row.tanggal, total: 0 };
      }
      dateMap[row.tanggal][row.lokasi] = row.alert;
      dateMap[row.tanggal].total += row.alert;
    });
    return Object.values(dateMap).sort((a, b) => a.tanggal.localeCompare(b.tanggal));
  }, [alertsDaily]);

  // Unique locations in daily data for Bar components
  const dailyLocationNames = useMemo(() => {
    const set = new Set();
    alertsDaily.forEach((d) => set.add(d.lokasi));
    return Array.from(set);
  }, [alertsDaily]);

  // Transform alertsHourly for stacked bar chart: group by hour 0..23
  const stackedHourlyData = useMemo(() => {
    if (!alertsHourly || alertsHourly.length === 0) return [];
    const hourMap = {};
    for (let h = 0; h < 24; h++) {
      hourMap[h] = { jam: h, jamLabel: `${String(h).padStart(2, "0")}:00`, total: 0 };
    }
    alertsHourly.forEach((row) => {
      if (hourMap[row.jam]) {
        hourMap[row.jam][row.lokasi] = row.alert;
        hourMap[row.jam].total += row.alert;
      }
    });
    return Object.values(hourMap);
  }, [alertsHourly]);

  // Unique locations in hourly data for Bar components
  const hourlyLocationNames = useMemo(() => {
    const set = new Set();
    alertsHourly.forEach((d) => set.add(d.lokasi));
    return Array.from(set);
  }, [alertsHourly]);

  return (
    <div className="space-y-6">
      {/* 1. Top Header & Filter Bar */}
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Analisis & Riwayat Pelanggaran</h1>
        <p className="text-sm text-muted">
          Pantau riwayat parkir liar / PKL di bahu jalan dan evaluasi respon penanganan pelanggaran
        </p>
      </header>

      {/* Shared Filter Bar: Date Range + Multi-select Perangkat */}
      <FilterBar
        filters={filters}
        onFiltersChange={handleFiltersChange}
        devices={devices}
        onRefresh={handleRefresh}
        loading={loading}
      />

      {/* Error Alert with Retry button */}
      {error && (
        <div className="panel flex items-center justify-between border-danger bg-danger/10 p-4 text-danger">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span className="text-sm font-medium">{error}</span>
          </div>
          <button
            onClick={handleRefresh}
            className="rounded bg-danger px-3 py-1 text-xs font-semibold text-white hover:bg-danger/90"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* 2. 4 Kartu KPI */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Ringkasan KPI">
        <KpiCard
          title="Total Alert"
          value={formatNumber(summary?.total_alert)}
          subtitle="Pelanggaran terdeteksi"
          icon={Bell}
          tone="accent"
          loading={loading}
        />
        <KpiCard
          title="Alert Terbuka"
          value={formatNumber(summary?.alert_terbuka)}
          subtitle={summary?.alert_terbuka > 0 ? "Perlu tindakan petugas" : "Semua lokasi aman"}
          icon={AlertCircle}
          tone={summary?.alert_terbuka > 0 ? "danger" : "ok"}
          loading={loading}
        />
        <KpiCard
          title="% Selesai"
          value={formatPercent(summary?.persen_selesai)}
          subtitle="Tingkat respon petugas"
          icon={CheckCircle2}
          tone="ok"
          loading={loading}
        />
        <KpiCard
          title="Median Waktu Penanganan"
          value={
            summary?.median_waktu_penanganan_menit !== null &&
            summary?.median_waktu_penanganan_menit !== undefined
              ? formatMinutes(summary?.median_waktu_penanganan_menit)
              : "-"
          }
          subtitle="Kecepatan penanganan"
          icon={Clock}
          tone="warn"
          loading={loading}
        />
      </section>

      {/* 3. 3 Grafik Analisis */}
      <section className="space-y-6" aria-label="Grafik Analisis Alert">
        {/* Row 1: (a) Bar Bertumpuk per Hari & (b) Bar Horizontal per Lokasi */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* (a) Bar Bertumpuk Alert per Hari per Lokasi */}
          <ChartCard
            title="Jumlah Alert per Hari"
            locations={activeLocations}
            loading={loading}
            empty={stackedDailyData.length === 0}
          >
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={stackedDailyData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis
                  dataKey="tanggal"
                  tickFormatter={(v) => formatWibDate(v).split(" ").slice(0, 2).join(" ")}
                  stroke="currentColor"
                  className="text-xs text-muted"
                />
                <YAxis stroke="currentColor" className="text-xs text-muted" allowDecimals={false} />
                <Tooltip
                  formatter={(val, name) => [
                    `${val} alert`,
                    locationCoordsMap[name] ? `${name} [${locationCoordsMap[name]}]` : name,
                  ]}
                  labelFormatter={(lbl) => `Tanggal: ${formatWibDate(lbl)}`}
                  contentStyle={{ backgroundColor: "var(--surface)", borderColor: "var(--line)" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {dailyLocationNames.map((locName, idx) => (
                  <Bar
                    key={locName}
                    dataKey={locName}
                    name={locName}
                    stackId="daily"
                    fill={COLORS[idx % COLORS.length]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* (b) Bar Horizontal Alert per Lokasi */}
          <ChartCard
            title="Jumlah Alert per Lokasi"
            locations={activeLocations}
            loading={loading}
            empty={activeLocations.length === 0}
          >
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={activeLocations} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis type="number" stroke="currentColor" className="text-xs text-muted" allowDecimals={false} />
                <YAxis
                  dataKey="lokasi"
                  type="category"
                  stroke="currentColor"
                  className="text-xs text-muted"
                  width={110}
                />
                <Tooltip
                  formatter={(val, name, item) => [
                    `${val} alert (${item.payload.terbuka} terbuka)`,
                    `${item.payload.lokasi} [${item.payload.koordinat}]`,
                  ]}
                  contentStyle={{ backgroundColor: "var(--surface)", borderColor: "var(--line)" }}
                />
                <Bar dataKey="alert" fill="rgb(var(--accent))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Row 2: (c) Bar Alert per Jam (0-23 WIB) */}
        <ChartCard
          title="Distribusi Alert per Jam (00:00 - 23:00 WIB)"
          locations={activeLocations}
          loading={loading}
          empty={stackedHourlyData.length === 0}
        >
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={stackedHourlyData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis
                dataKey="jamLabel"
                stroke="currentColor"
                className="text-xs text-muted"
              />
              <YAxis stroke="currentColor" className="text-xs text-muted" allowDecimals={false} />
              <Tooltip
                formatter={(val, name) => [
                  `${val} alert`,
                  locationCoordsMap[name] ? `${name} [${locationCoordsMap[name]}]` : name,
                ]}
                labelFormatter={(lbl) => `Pukul: ${lbl} WIB`}
                contentStyle={{ backgroundColor: "var(--surface)", borderColor: "var(--line)" }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {hourlyLocationNames.map((locName, idx) => (
                <Bar
                  key={locName}
                  dataKey={locName}
                  name={locName}
                  stackId="hourly"
                  fill={COLORS[idx % COLORS.length]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>

      {/* 4. Tabel Ringkasan per Lokasi */}
      <section className="panel" aria-label="Tabel Ringkasan per Lokasi">
        <header className="panel-head border-b border-line p-4">
          <h3 className="text-base font-semibold text-ink">Ringkasan per Lokasi</h3>
          <p className="mt-0.5 text-xs text-muted font-mono">
            {formatLocationSubtitle(activeLocations)}
          </p>
        </header>
        <Table label="Ringkasan pelanggaran per lokasi">
          <thead>
            <tr>
              <th className="text-left">Lokasi</th>
              <th className="text-left">Koordinat GPS</th>
              <th className="text-right">Total Alert</th>
              <th className="text-right">Alert Terbuka</th>
              <th className="text-right">Median Penanganan</th>
              <th className="text-right">Jam Puncak</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows cols={6} rows={3} />
            ) : activeLocations.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted">
                  <EmptyState description="Tidak ada data untuk lokasi terpilih." />
                </td>
              </tr>
            ) : (
              activeLocations.map((loc) => (
                <tr key={loc.device_id} className="hover:bg-sunken/40">
                  <td className="font-semibold text-ink">{loc.lokasi}</td>
                  <td className="font-mono text-xs text-muted">{loc.koordinat}</td>
                  <td className="text-right font-mono text-sm">{formatNumber(loc.alert)}</td>
                  <td className="text-right font-mono text-sm">
                    {loc.terbuka > 0 ? (
                      <span className="font-bold text-danger">{loc.terbuka}</span>
                    ) : (
                      <span className="text-ok font-medium">0</span>
                    )}
                  </td>
                  <td className="text-right font-mono text-sm">
                    {loc.median_penanganan_menit !== null
                      ? formatMinutes(loc.median_penanganan_menit)
                      : "-"}
                  </td>
                  <td className="text-right font-mono text-sm font-medium text-warn-text">
                    {loc.jam_puncak !== null
                      ? `Pukul ${String(loc.jam_puncak).padStart(2, "0")}:00 WIB`
                      : "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </section>

      {/* 5. Tabel Alert Terbaru (50 Data dari GET /api/alerts/) */}
      <section className="panel" aria-label="Tabel Alert Terbaru">
        <header className="panel-head border-b border-line p-4">
          <h3 className="text-base font-semibold text-ink">Alert Terbaru (50 Kejadian Terakhir)</h3>
          <p className="mt-0.5 text-xs text-muted">
            Riwayat insiden deteksi kendaraan / PKL terparkir di bahu jalan
          </p>
        </header>
        <Table label="Daftar alert terbaru">
          <thead>
            <tr>
              <th className="text-left">Waktu (WIB)</th>
              <th className="text-left">Lokasi</th>
              <th className="text-left">Unit</th>
              <th className="text-left">Tipe</th>
              <th className="text-right">Pengulangan</th>
              <th className="text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {recentLoading ? (
              <SkeletonRows cols={6} rows={5} />
            ) : recentAlerts.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted">
                  <EmptyState description="Belum ada riwayat alert yang tercatat." />
                </td>
              </tr>
            ) : (
              recentAlerts.map((alert) => (
                <tr key={alert.id} className="hover:bg-sunken/40">
                  <td className="font-mono text-xs text-muted whitespace-nowrap">
                    {formatWibDateTime(alert.created_at)}
                  </td>
                  <td className="font-semibold text-ink">
                    {alert.device_name || alert.device_id}
                  </td>
                  <td className="font-mono text-xs">Sensor {alert.unit_id}</td>
                  <td>
                    <span className="font-medium text-ink">{alert.event_name || alert.alert_type}</span>
                  </td>
                  <td className="text-right font-mono text-xs">
                    {formatNumber(alert.occurrences)}x
                  </td>
                  <td>
                    {alert.is_resolved ? (
                      <StatusBadge tone="ok">Selesai</StatusBadge>
                    ) : (
                      <StatusBadge tone="danger">Terbuka</StatusBadge>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
