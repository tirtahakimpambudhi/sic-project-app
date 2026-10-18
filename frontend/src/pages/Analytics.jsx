import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  Bell,
  CheckCircle2,
  Clock,
  Radio,
  WifiOff,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import Table from "../components/Table.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import FilterBar from "../components/analytics/FilterBar.jsx";
import KpiCard from "../components/analytics/KpiCard.jsx";
import ChartCard from "../components/analytics/ChartCard.jsx";
import HeatmapChart from "../components/analytics/HeatmapChart.jsx";
import AlertsTable from "../components/analytics/AlertsTable.jsx";
import useDevices from "../hooks/useDevices.js";
import analyticsApi from "../services/analyticsApi.js";
import {
  DAYS_ID,
  formatLocationSubtitle,
  formatMinutes,
  formatNumber,
  formatPercent,
  formatWibDate,
  formatWibDateTime,
  getDatePreset,
} from "../utils/analytics.js";
import { formatPins } from "../utils/format.js";

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

// Plain, friendly labels for detection states understandable by operators & Satpol PP
const DETECTION_STATE_LABELS = {
  idle: "Jalan Kosong",
  detected: "Objek Mendekat",
  confirmed: "Pelanggaran Terdeteksi",
  cleared: "Kembali Kosong",
};

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

  // Active tab state
  const [activeTab, setActiveTab] = useState("ringkasan");

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

  // Tab 1 data
  const [summary, setSummary] = useState(null);
  const [alertsDaily, setAlertsDaily] = useState([]);
  const [alertsByLocation, setAlertsByLocation] = useState([]);
  const [alertsHeatmap, setAlertsHeatmap] = useState(null);

  // Tab 2 data
  const [alertsByType, setAlertsByType] = useState([]);
  const [alertsDuration, setAlertsDuration] = useState(null);
  const [alertsByUnit, setAlertsByUnit] = useState([]);

  // Tab 3 data
  const [telByLocation, setTelByLocation] = useState([]);
  const [telCoverage, setTelCoverage] = useState([]);
  const [telStateMix, setTelStateMix] = useState([]);
  const [telDistance, setTelDistance] = useState(null);
  const [telGaps, setTelGaps] = useState([]);
  const [selectedUnitForDistance, setSelectedUnitForDistance] = useState(0);
  const [selectedDeviceForDistance, setSelectedDeviceForDistance] = useState("");

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  // Fetch all tab data
  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.allSettled([
      analyticsApi.getSummary(filters),
      analyticsApi.getAlertsDaily(filters),
      analyticsApi.getAlertsByLocation(filters),
      analyticsApi.getAlertsHeatmap(filters),
      analyticsApi.getAlertsByType(filters),
      analyticsApi.getAlertsDuration(filters),
      analyticsApi.getAlertsByUnit(filters),
      analyticsApi.getTelemetryByLocation(filters),
      analyticsApi.getTelemetryCoverage(filters),
      analyticsApi.getTelemetryStateMix(filters),
      analyticsApi.getTelemetryGaps(filters),
    ]).then((results) => {
      if (!active) return;
      if (results[0].status === "fulfilled") setSummary(results[0].value);
      if (results[1].status === "fulfilled") setAlertsDaily(results[1].value);
      if (results[2].status === "fulfilled") setAlertsByLocation(results[2].value);
      if (results[3].status === "fulfilled") setAlertsHeatmap(results[3].value);
      if (results[4].status === "fulfilled") setAlertsByType(results[4].value);
      if (results[5].status === "fulfilled") setAlertsDuration(results[5].value);
      if (results[6].status === "fulfilled") setAlertsByUnit(results[6].value);
      if (results[7].status === "fulfilled") setTelByLocation(results[7].value);
      if (results[8].status === "fulfilled") setTelCoverage(results[8].value);
      if (results[9].status === "fulfilled") setTelStateMix(results[9].value);
      if (results[10].status === "fulfilled") setTelGaps(results[10].value);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [filters, refreshKey]);

  // Fetch telemetry distance when unit / device filter changes
  useEffect(() => {
    let active = true;
    const targetDev =
      selectedDeviceForDistance || (filters.device?.[0] ?? devices[0]?.device_id);
    if (!targetDev) return;

    analyticsApi
      .getTelemetryDistance(filters, {
        device: targetDev,
        unitId: selectedUnitForDistance,
      })
      .then((res) => {
        if (active) setTelDistance(res);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [filters, selectedDeviceForDistance, selectedUnitForDistance, devices, refreshKey]);

  // Active locations list from summary
  const activeLocations = summary?.lokasi || [];

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

  // Telemetry KPIs from telByLocation
  const telemetrySummary = useMemo(() => {
    if (!telByLocation || telByLocation.length === 0) {
      return { totalBacaan: 0, avgKelengkapan: 0, avgNoEcho: 0 };
    }
    const totalBacaan = telByLocation.reduce((acc, l) => acc + l.bacaan, 0);
    const avgKelengkapan =
      telByLocation.reduce((acc, l) => acc + l.kelengkapan_persen, 0) / telByLocation.length;
    const avgNoEcho =
      telByLocation.reduce((acc, l) => acc + l.persen_tanpa_echo, 0) / telByLocation.length;
    return {
      totalBacaan,
      avgKelengkapan: Math.round(avgKelengkapan * 10) / 10,
      avgNoEcho: Math.round(avgNoEcho * 10) / 10,
    };
  }, [telByLocation]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Analisis & Riwayat Pelanggaran</h1>
        <p className="text-sm text-muted">
          Pantau riwayat parkir liar / PKL di bahu jalan dan periksa kondisi keaktifan alat sensor di lapangan
        </p>
      </header>

      {/* Shared Filter Bar */}
      <FilterBar
        filters={filters}
        onFiltersChange={handleFiltersChange}
        devices={devices}
        onRefresh={handleRefresh}
        loading={loading}
      />

      {/* Navigation Tabs */}
      <div className="flex border-b border-line">
        <nav className="-mb-px flex space-x-6 overflow-x-auto" aria-label="Tab Analisis">
          {[
            { id: "ringkasan", label: "Ringkasan" },
            { id: "alert", label: "Riwayat Pelanggaran" },
            { id: "telemetri", label: "Kondisi Alat & Sensor" },
            { id: "perangkat", label: "Daftar Titik & Alat" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap border-b-2 py-3 text-sm font-semibold transition-colors ${
                activeTab === tab.id
                  ? "border-accent text-accent-text"
                  : "border-transparent text-muted hover:border-line hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* =========================================================================
          TAB 1: RINGKASAN
          ========================================================================= */}
      {activeTab === "ringkasan" && (
        <div className="space-y-6">
          {/* 5 KPI Cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard
              title="Total Pelanggaran"
              value={formatNumber(summary?.total_alert)}
              subtitle={`${formatNumber(summary?.total_pengulangan)} kali alarm berbunyi`}
              icon={Bell}
              tone="accent"
              loading={loading}
            />
            <KpiCard
              title="Belum Ditangani"
              value={formatNumber(summary?.alert_terbuka)}
              subtitle={summary?.alert_terbuka > 0 ? "Perlu tindakan petugas" : "Semua lokasi aman"}
              icon={AlertCircle}
              tone={summary?.alert_terbuka > 0 ? "danger" : "ok"}
              loading={loading}
            />
            <KpiCard
              title="Sudah Ditangani"
              value={formatPercent(summary?.persen_selesai)}
              subtitle="Tingkat respon petugas"
              icon={CheckCircle2}
              tone="ok"
              loading={loading}
            />
            <KpiCard
              title="Waktu Respon Petugas"
              value={
                summary?.median_waktu_penanganan_menit !== null &&
                summary?.median_waktu_penanganan_menit !== undefined
                  ? formatMinutes(summary?.median_waktu_penanganan_menit)
                  : "-"
              }
              subtitle={
                summary?.rata2_durasi_insiden_menit !== null
                  ? `Rata-rata lama parkir: ${formatMinutes(summary?.rata2_durasi_insiden_menit)}`
                  : "Belum ada riwayat"
              }
              icon={Clock}
              tone="warn"
              loading={loading}
            />
            <KpiCard
              title="Alat Aktif di Lapangan"
              value={`${summary?.perangkat_online ?? 0}/${summary?.perangkat_total ?? 0}`}
              subtitle="Titik siap mendeteksi"
              icon={Radio}
              tone={summary?.perangkat_online === summary?.perangkat_total ? "ok" : "warn"}
              loading={loading}
            />
          </div>

          {/* Charts Row 1: Daily Stacked Bar & Horizontal Bar by Location */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartCard
              title="Jumlah Pelanggaran per Hari"
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
                    formatter={(val, name) => [`${val} pelanggaran`, name]}
                    labelFormatter={(lbl) => `Tanggal: ${formatWibDate(lbl)}`}
                    contentStyle={{ backgroundColor: "var(--surface)", borderColor: "var(--line)" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {dailyLocationNames.map((locName, idx) => (
                    <Bar
                      key={locName}
                      dataKey={locName}
                      name={locName}
                      stackId="a"
                      fill={COLORS[idx % COLORS.length]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Lokasi Paling Sering Terjadi Pelanggaran"
              locations={activeLocations}
              loading={loading}
              empty={alertsByLocation.length === 0}
            >
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={alertsByLocation} layout="vertical">
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
                      `${val} pelanggaran (${item.payload.terbuka} belum selesai)`,
                      `${item.payload.lokasi} [${item.payload.koordinat}]`,
                    ]}
                    contentStyle={{ backgroundColor: "var(--surface)", borderColor: "var(--line)" }}
                  />
                  <Bar dataKey="alert" fill="rgb(var(--accent))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Table: Ringkasan per Lokasi */}
          <section className="panel">
            <header className="panel-head border-b border-line p-4">
              <h3 className="text-base font-semibold text-ink">Ringkasan Tiap Titik Lokasi</h3>
              <p className="mt-0.5 text-xs text-muted font-mono">
                {formatLocationSubtitle(activeLocations)}
              </p>
            </header>
            <Table label="Ringkasan pelanggaran per titik lokasi">
              <thead>
                <tr>
                  <th className="text-left">Nama Lokasi</th>
                  <th className="text-left">Koordinat GPS</th>
                  <th className="text-right">Total Pelanggaran</th>
                  <th className="text-right">Belum Ditangani</th>
                  <th className="text-right">Alarm Berbunyi</th>
                  <th className="text-right">Respon Petugas</th>
                  <th className="text-right">Jam Paling Rawan</th>
                </tr>
              </thead>
              <tbody>
                {alertsByLocation.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted">
                      Tidak ada catatan pelanggaran untuk lokasi terpilih.
                    </td>
                  </tr>
                ) : (
                  alertsByLocation.map((loc) => (
                    <tr key={loc.device_id} className="hover:bg-sunken/40">
                      <td className="font-semibold text-ink">{loc.lokasi}</td>
                      <td className="font-mono text-xs text-muted">{loc.koordinat}</td>
                      <td className="text-right font-mono text-sm">{formatNumber(loc.alert)}</td>
                      <td className="text-right font-mono text-sm">
                        {loc.terbuka > 0 ? (
                          <span className="font-bold text-danger">{loc.terbuka}</span>
                        ) : (
                          <span className="text-ok font-medium">0 (Aman)</span>
                        )}
                      </td>
                      <td className="text-right font-mono text-sm">
                        {formatNumber(loc.pengulangan)}x
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

          {/* Heatmaps Row: Hari x Jam & Lokasi x Jam */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartCard
              title="Waktu Paling Rawan (Hari & Jam)"
              subtitle="Melihat jam berapa pelanggaran sering terjadi di hari kerja maupun akhir pekan"
              loading={loading}
              empty={!alertsHeatmap?.hari_jam}
            >
              <HeatmapChart
                matrix={alertsHeatmap?.hari_jam || []}
                rowLabels={DAYS_ID}
                unitLabel="pelanggaran"
              />
            </ChartCard>

            <ChartCard
              title="Jam Rawan di Setiap Titik Lokasi"
              locations={activeLocations}
              loading={loading}
              empty={!alertsHeatmap?.lokasi_jam || alertsHeatmap.lokasi_jam.length === 0}
            >
              <HeatmapChart
                matrix={(alertsHeatmap?.lokasi_jam || []).map((l) => l.jam)}
                rowLabels={(alertsHeatmap?.lokasi_jam || []).map((l) => l.lokasi)}
                locations={alertsHeatmap?.lokasi_jam || []}
                unitLabel="pelanggaran"
              />
            </ChartCard>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 2: RIWAYAT PELANGGARAN (TIDAK ADA GRAFIK PETA DI TAB INI)
          ========================================================================= */}
      {activeTab === "alert" && (
        <div className="space-y-6">
          {/* Charts Row: Donut Jenis Pelanggaran, Histogram Durasi, Bar Unit */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Donut Chart: Jenis Pelanggaran */}
            <ChartCard
              title="Jenis Pelanggaran"
              locations={activeLocations}
              loading={loading}
              empty={alertsByType.length === 0}
            >
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={alertsByType}
                    dataKey="jumlah"
                    nameKey="event_name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                  >
                    {alertsByType.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val, name) => [
                      `${val} kejadian`,
                      name,
                    ]}
                    contentStyle={{ backgroundColor: "var(--surface)", borderColor: "var(--line)" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Histogram: Lama Pelanggaran Berlangsung */}
            <ChartCard
              title="Lama Pelanggaran Berlangsung"
              locations={activeLocations}
              loading={loading}
              empty={!alertsDuration?.bins}
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={(alertsDuration?.bins || []).map((b) => ({
                    label: b.sampai ? `${b.dari}-${b.sampai} mnt` : `>${b.dari} mnt`,
                    jumlah: b.jumlah,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="label" stroke="currentColor" className="text-xs text-muted" />
                  <YAxis stroke="currentColor" className="text-xs text-muted" allowDecimals={false} />
                  <Tooltip
                    formatter={(val) => [`${val} kali kejadian`, "Jumlah Kejadian"]}
                    contentStyle={{ backgroundColor: "var(--surface)", borderColor: "var(--line)" }}
                  />
                  <Bar dataKey="jumlah" fill="#ea580c" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Bar: Pelanggaran per Sensor */}
            <ChartCard
              title="Pelanggaran per Sensor"
              locations={activeLocations}
              loading={loading}
              empty={alertsByUnit.length === 0}
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={alertsByUnit.map((u) => ({
                    unit_label: `${u.lokasi.split(" ")[0]} Sensor ${u.unit_id}`,
                    alert: u.alert,
                    pengulangan: u.pengulangan,
                    full_label: `${u.lokasi} / Sensor ${u.unit_id} [${u.koordinat}]`,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="unit_label" stroke="currentColor" className="text-xs text-muted" />
                  <YAxis stroke="currentColor" className="text-xs text-muted" allowDecimals={false} />
                  <Tooltip
                    formatter={(val, name, item) => [
                      `${val} ${name === "alert" ? "pelanggaran" : "kali alarm berbunyi"}`,
                      item.payload.full_label,
                    ]}
                    contentStyle={{ backgroundColor: "var(--surface)", borderColor: "var(--line)" }}
                  />
                  <Bar dataKey="alert" fill="rgb(var(--accent))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Table: Daftar Pelanggaran Terpaginasi & CSV Export */}
          <section className="panel p-4">
            <header className="mb-4">
              <h3 className="text-base font-semibold text-ink">Daftar Riwayat Pelanggaran</h3>
              <p className="text-xs text-muted font-mono">
                {formatLocationSubtitle(activeLocations)}
              </p>
            </header>
            <AlertsTable filters={filters} />
          </section>
        </div>
      )}

      {/* =========================================================================
          TAB 3: KONDISI ALAT & SENSOR
          ========================================================================= */}
      {activeTab === "telemetri" && (
        <div className="space-y-6">
          {/* 3 Metric Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard
              title="Total Sinyal Sensor"
              value={formatNumber(telemetrySummary.totalBacaan)}
              subtitle="Sinyal pemantauan diterima"
              icon={Activity}
              tone="tech"
              loading={loading}
            />
            <KpiCard
              title="Kestabilan Sinyal Alat"
              value={formatPercent(telemetrySummary.avgKelengkapan)}
              subtitle="Tingkat keaktifan alat kirim data"
              icon={CheckCircle2}
              tone={telemetrySummary.avgKelengkapan >= 80 ? "ok" : "warn"}
              loading={loading}
            />
            <KpiCard
              title="Bahu Jalan Aman (Kosong)"
              value={formatPercent(telemetrySummary.avgNoEcho)}
              subtitle="Sensor tidak mendeteksi kendaraan/objek"
              icon={WifiOff}
              tone="neutral"
              loading={loading}
            />
          </div>

          {/* Bar & Table: Kestabilan Sinyal per Lokasi */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartCard
              title="Kestabilan Sinyal Tiap Lokasi"
              locations={activeLocations}
              loading={loading}
              empty={telByLocation.length === 0}
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={telByLocation}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="lokasi" stroke="currentColor" className="text-xs text-muted" />
                  <YAxis
                    domain={[0, 100]}
                    stroke="currentColor"
                    className="text-xs text-muted"
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    formatter={(val, _, item) => [
                      `${val}% sinyal aktif (${item.payload.bacaan} sinyal diterima)`,
                      `${item.payload.lokasi} [${item.payload.koordinat}]`,
                    ]}
                    contentStyle={{ backgroundColor: "var(--surface)", borderColor: "var(--line)" }}
                  />
                  <Bar dataKey="kelengkapan_persen" fill="#16a34a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <section className="panel">
              <header className="panel-head border-b border-line p-4">
                <h3 className="text-base font-semibold text-ink">Kondisi Keaktifan Alat per Lokasi</h3>
                <p className="text-xs text-muted font-mono">{formatLocationSubtitle(activeLocations)}</p>
              </header>
              <Table label="Kondisi keaktifan alat per lokasi">
                <thead>
                  <tr>
                    <th className="text-left">Lokasi</th>
                    <th className="text-right">Sinyal Diterima</th>
                    <th className="text-right">Kestabilan Sinyal</th>
                    <th className="text-right">Jalan Kosong</th>
                    <th className="text-right">Ada Pelanggaran</th>
                    <th className="text-right">Jarak Rata-rata</th>
                  </tr>
                </thead>
                <tbody>
                  {telByLocation.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-muted">
                        Tidak ada catatan sinyal alat untuk filter ini.
                      </td>
                    </tr>
                  ) : (
                    telByLocation.map((item) => (
                      <tr key={item.lokasi} className="hover:bg-sunken/40">
                        <td className="font-semibold text-ink">
                          <div>{item.lokasi}</div>
                          <div className="font-mono text-[11px] text-muted">{item.koordinat}</div>
                        </td>
                        <td className="text-right font-mono text-sm">{formatNumber(item.bacaan)}</td>
                        <td className="text-right font-mono text-sm font-semibold text-ok">
                          {formatPercent(item.kelengkapan_persen)}
                        </td>
                        <td className="text-right font-mono text-sm text-muted">
                          {formatPercent(item.persen_tanpa_echo)}
                        </td>
                        <td className="text-right font-mono text-sm text-danger">
                          {formatPercent(item.persen_confirmed)}
                        </td>
                        <td className="text-right font-mono text-sm">
                          {item.jarak_median_cm !== null ? `${item.jarak_median_cm} cm` : "-"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </section>
          </div>

          {/* State Mix & Sinyal per Jam */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartCard
              title="Status Pemantauan Sensor"
              locations={activeLocations}
              loading={loading}
              empty={telStateMix.length === 0}
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={telStateMix}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="unit_label" stroke="currentColor" className="text-xs text-muted" />
                  <YAxis stroke="currentColor" className="text-xs text-muted" tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    formatter={(val, name, item) => [
                      `${val}% (${item.payload.jumlah} data)`,
                      `Status: ${DETECTION_STATE_LABELS[item.payload.detection_state] || item.payload.detection_state}`,
                    ]}
                    contentStyle={{ backgroundColor: "var(--surface)", borderColor: "var(--line)" }}
                  />
                  <Bar dataKey="persen" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Keaktifan Sinyal Alat Sepanjang Hari"
              locations={activeLocations}
              loading={loading}
              empty={telCoverage.length === 0}
            >
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={telCoverage}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis
                    dataKey="jam"
                    stroke="currentColor"
                    className="text-xs text-muted"
                    tickFormatter={(v) => v.split("T")[1]?.slice(0, 5) || v}
                  />
                  <YAxis
                    domain={[0, 100]}
                    stroke="currentColor"
                    className="text-xs text-muted"
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    formatter={(val, _, item) => [
                      `${val}% aktif`,
                      `${item.payload.unit_label} · ${formatWibDateTime(item.payload.jam)}`,
                    ]}
                    contentStyle={{ backgroundColor: "var(--surface)", borderColor: "var(--line)" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="kelengkapan_persen"
                    stroke="#0891b2"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Line Chart: Jarak Sensor dengan Garis Batas & Selector Sensor */}
          <ChartCard
            title="Jarak Objek ke Sensor Bahu Jalan"
            subtitle="Garis merah putus-putus adalah batas bahu jalan. Jika kendaraan parkir lebih dekat dari batas ini dan melebihi batas waktu, alarm akan berbunyi."
            locations={activeLocations}
            loading={loading}
            empty={!telDistance?.data || telDistance.data.length === 0}
            actions={
              <div className="flex items-center gap-2">
                <select
                  value={selectedDeviceForDistance || (devices[0]?.device_id ?? "")}
                  onChange={(e) => setSelectedDeviceForDistance(e.target.value)}
                  className="rounded border border-line bg-surface px-2 py-1 text-xs text-ink focus:outline-none"
                  aria-label="Pilih lokasi alat"
                >
                  {devices.map((d) => (
                    <option key={d.device_id} value={d.device_id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedUnitForDistance}
                  onChange={(e) => setSelectedUnitForDistance(Number(e.target.value))}
                  className="rounded border border-line bg-surface px-2 py-1 text-xs text-ink focus:outline-none"
                  aria-label="Pilih nomor sensor"
                >
                  <option value={0}>Sensor 0</option>
                  <option value={1}>Sensor 1</option>
                  <option value={2}>Sensor 2</option>
                  <option value={3}>Sensor 3</option>
                </select>
              </div>
            }
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={telDistance?.data || []}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis
                  dataKey="waktu"
                  stroke="currentColor"
                  className="text-xs text-muted"
                  tickFormatter={(v) => v.split("T")[1]?.slice(0, 5) || v}
                />
                <YAxis stroke="currentColor" className="text-xs text-muted" unit=" cm" />
                <Tooltip
                  formatter={(val) => [`${val} cm`, "Jarak Objek"]}
                  labelFormatter={(lbl) => `Waktu: ${formatWibDateTime(lbl)}`}
                  contentStyle={{ backgroundColor: "var(--surface)", borderColor: "var(--line)" }}
                />
                {telDistance?.tolerant_distance_cm && (
                  <ReferenceLine
                    y={telDistance.tolerant_distance_cm}
                    stroke="#dc2626"
                    strokeDasharray="4 4"
                    label={{
                      value: `Batas Bahu Jalan (${telDistance.tolerant_distance_cm} cm)`,
                      fill: "#dc2626",
                      fontSize: 12,
                      position: "top",
                    }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="distance_cm"
                  stroke="rgb(var(--accent))"
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Table: Riwayat Alat Sempat Mati / Hilang Sinyal */}
          <section className="panel">
            <header className="panel-head border-b border-line p-4">
              <h3 className="text-base font-semibold text-ink">Riwayat Alat Sempat Mati / Hilang Sinyal</h3>
              <p className="mt-0.5 text-xs text-muted">
                Catatan saat alat di lapangan tidak mengirim sinyal lebih dari 30 detik (kemungkinan listrik padam atau kendala jaringan internet)
              </p>
            </header>
            <Table label="Daftar riwayat alat sempat mati">
              <thead>
                <tr>
                  <th className="text-left">Sensor</th>
                  <th className="text-left">Lokasi Alat</th>
                  <th className="text-left">Koordinat GPS</th>
                  <th className="text-left">Mulai Hilang (WIB)</th>
                  <th className="text-left">Kembali Menyala (WIB)</th>
                  <th className="text-right">Lama Alat Mati</th>
                </tr>
              </thead>
              <tbody>
                {telGaps.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted">
                      Kondisi prima. Semua alat di lapangan terus menyala dan aktif mengirim data tanpa gangguan.
                    </td>
                  </tr>
                ) : (
                  telGaps.map((gap, i) => (
                    <tr key={i} className="hover:bg-sunken/40">
                      <td className="font-semibold text-ink">
                        {gap.unit_label.replace(/U(\d+)/, "Sensor $1")}
                      </td>
                      <td className="text-sm">{gap.lokasi}</td>
                      <td className="font-mono text-xs text-muted">{gap.koordinat}</td>
                      <td className="font-mono text-xs text-muted">
                        {formatWibDateTime(gap.mulai)}
                      </td>
                      <td className="font-mono text-xs text-muted">
                        {formatWibDateTime(gap.selesai)}
                      </td>
                      <td className="text-right font-mono text-sm font-semibold text-warn-text">
                        {formatMinutes(gap.durasi_menit)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </section>
        </div>
      )}

      {/* =========================================================================
          TAB 4: DAFTAR TITIK & ALAT
          ========================================================================= */}
      {activeTab === "perangkat" && (
        <div className="space-y-6">
          {/* Table: Lokasi Perangkat */}
          <section className="panel">
            <header className="panel-head border-b border-line p-4">
              <h3 className="text-base font-semibold text-ink">Daftar Lokasi Alat di Lapangan</h3>
              <p className="mt-0.5 text-xs text-muted">
                Daftar alat pendeteksi yang terpasang di bahu jalan, posisi GPS, dan batas jarak deteksi
              </p>
            </header>
            <Table label="Daftar lokasi alat">
              <thead>
                <tr>
                  <th className="text-left">Nama Lokasi</th>
                  <th className="text-left">ID Alat</th>
                  <th className="text-left">Koordinat GPS</th>
                  <th className="text-left">Status Alat</th>
                  <th className="text-left">Terakhir Kirim Sinyal</th>
                  <th className="text-right">Batas Jarak Bahu Jalan</th>
                  <th className="text-right">Batas Waktu Sebelum Alarm</th>
                </tr>
              </thead>
              <tbody>
                {devices.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted">
                      Belum ada alat yang terpasang di lapangan.
                    </td>
                  </tr>
                ) : (
                  devices.map((dev) => (
                    <tr key={dev.device_id} className="hover:bg-sunken/40">
                      <td className="font-semibold text-ink">{dev.name}</td>
                      <td className="font-mono text-xs text-muted">{dev.device_id}</td>
                      <td className="font-mono text-xs text-muted">
                        {dev.latitude?.toFixed(5)}, {dev.longitude?.toFixed(5)}
                      </td>
                      <td>
                        {dev.is_online ? (
                          <StatusBadge tone="ok">Aktif</StatusBadge>
                        ) : (
                          <StatusBadge tone="neutral">Mati / Offline</StatusBadge>
                        )}
                      </td>
                      <td className="font-mono text-xs text-muted">
                        {formatWibDateTime(dev.last_seen)}
                      </td>
                      <td className="text-right font-mono text-xs">
                        {dev.tolerant_distance_cm} cm
                      </td>
                      <td className="text-right font-mono text-xs">
                        {dev.timeout_seconds} detik
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </section>

          {/* Table: Sensor Units */}
          <section className="panel">
            <header className="panel-head border-b border-line p-4">
              <h3 className="text-base font-semibold text-ink">Kondisi Komponen Sensor</h3>
              <p className="mt-0.5 text-xs text-muted">
                Pemeriksaan fungsi sensor pendeteksi jarak, sirine/buzzer, dan sudut pantau di setiap alat
              </p>
            </header>
            <Table label="Daftar kondisi komponen sensor">
              <thead>
                <tr>
                  <th className="text-left">Lokasi Alat</th>
                  <th className="text-left">Nomor Sensor</th>
                  <th className="text-left">Jalur Kabel (Pin)</th>
                  <th className="text-left">Kondisi Pantauan</th>
                  <th className="text-left">Ada Objek?</th>
                  <th className="text-left">Sirine / Buzzer</th>
                  <th className="text-right">Jarak Terakhir</th>
                  <th className="text-right">Arah Sensor</th>
                </tr>
              </thead>
              <tbody>
                {devices.flatMap((dev) =>
                  (dev.units || []).map((unit) => (
                    <tr key={`${dev.device_id}-${unit.unit_id}`} className="hover:bg-sunken/40">
                      <td className="font-semibold text-ink">{dev.name}</td>
                      <td className="font-mono text-xs">Sensor {unit.unit_id}</td>
                      <td className="font-mono text-xs text-muted">{formatPins(unit)}</td>
                      <td>
                        <span className="capitalize font-mono text-xs">
                          {DETECTION_STATE_LABELS[unit.detection_state] || unit.detection_state || "-"}
                        </span>
                      </td>
                      <td>
                        {unit.is_object_detected ? (
                          <StatusBadge tone="danger">Ada Objek</StatusBadge>
                        ) : (
                          <span className="text-xs text-muted">Kosong</span>
                        )}
                      </td>
                      <td>
                        {unit.buzzer_active ? (
                          <span className="font-semibold text-danger text-xs">Berbunyi</span>
                        ) : (
                          <span className="text-xs text-muted">Senyap</span>
                        )}
                      </td>
                      <td className="text-right font-mono text-xs">
                        {unit.last_distance_cm !== null ? `${unit.last_distance_cm} cm` : "-"}
                      </td>
                      <td className="text-right font-mono text-xs">
                        {unit.servo_position !== null ? `${unit.servo_position}°` : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </section>
        </div>
      )}
    </div>
  );
}
