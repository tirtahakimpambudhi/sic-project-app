import { useEffect, useState } from "react";
import { Download, ChevronLeft, ChevronRight } from "lucide-react";
import Button from "../Button.jsx";
import StatusBadge from "../StatusBadge.jsx";
import Table from "../Table.jsx";
import EmptyState from "../EmptyState.jsx";
import { SkeletonRows } from "../Skeleton.jsx";
import analyticsApi from "../../services/analyticsApi.js";
import { formatMinutes, formatNumber, formatWibDateTime } from "../../utils/analytics.js";

const STATUS_OPTIONS = [
  { id: "semua", label: "Semua Status" },
  { id: "terbuka", label: "Belum Ditangani" },
  { id: "selesai", label: "Sudah Selesai" },
];

export default function AlertsTable({ filters }) {
  const [status, setStatus] = useState("semua");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ results: [], count: 0, total_pages: 1 });
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    analyticsApi
      .getAlertsTable(filters, { page, pageSize: 50, status })
      .then((res) => {
        if (active) {
          setData(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filters, page, status]);

  const handleDownloadCsv = async () => {
    try {
      setDownloading(true);
      await analyticsApi.downloadAlertsCsv(filters, status);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Table Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Status Filter Tabs */}
        <div className="flex items-center rounded-control border border-line bg-surface p-1">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setStatus(opt.id);
                setPage(1);
              }}
              className={`rounded-control px-3 py-1 text-xs font-semibold transition-colors ${
                status === opt.id
                  ? "bg-accent-soft text-accent-text"
                  : "text-muted hover:bg-sunken hover:text-ink"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* CSV Export Button */}
        <Button
          variant="secondary"
          size="sm"
          icon={Download}
          onClick={handleDownloadCsv}
          disabled={downloading || data.count === 0}
        >
          {downloading ? "Mengunduh..." : "Unduh Data (CSV)"}
        </Button>
      </div>

      {/* Table Content */}
      <Table label="Daftar catatan pelanggaran">
        <thead>
          <tr>
            <th className="text-left">Waktu Kejadian (WIB)</th>
            <th className="text-left">Lokasi</th>
            <th className="text-left">Koordinat GPS</th>
            <th className="text-left">Sensor</th>
            <th className="text-left">Jenis Pelanggaran</th>
            <th className="text-right">Alarm Berulang</th>
            <th className="text-right">Lama Kejadian</th>
            <th className="text-left">Status</th>
            <th className="text-left">Petugas Penangan</th>
            <th className="text-right">Waktu Respon</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows cols={10} rows={5} />
          ) : data.results.length === 0 ? (
            <tr>
              <td colSpan={10} className="p-8 text-center">
                <EmptyState description="Tidak ada catatan pelanggaran yang sesuai dengan filter ini." />
              </td>
            </tr>
          ) : (
            data.results.map((alert) => (
              <tr key={alert.id} className="hover:bg-sunken/40">
                <td className="font-mono text-xs text-muted whitespace-nowrap">
                  {formatWibDateTime(alert.created_at)}
                </td>
                <td className="font-medium text-ink">{alert.lokasi}</td>
                <td className="font-mono text-xs text-muted">{alert.koordinat}</td>
                <td className="font-mono text-xs">Sensor {alert.unit_id}</td>
                <td>
                  <span className="font-medium">{alert.event_name}</span>
                </td>
                <td className="text-right font-mono text-xs">
                  {formatNumber(alert.occurrences)}x
                </td>
                <td className="text-right font-mono text-xs">
                  {formatMinutes(alert.durasi_menit)}
                </td>
                <td>
                  {alert.is_resolved ? (
                    <StatusBadge tone="ok">Sudah Selesai</StatusBadge>
                  ) : (
                    <StatusBadge tone="danger">Belum Ditangani</StatusBadge>
                  )}
                </td>
                <td className="text-xs text-muted">{alert.resolved_by || "-"}</td>
                <td className="text-right font-mono text-xs">
                  {alert.waktu_penanganan_menit !== null
                    ? formatMinutes(alert.waktu_penanganan_menit)
                    : "-"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </Table>

      {/* Pagination Footer */}
      {!loading && data.count > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <span>
            Total <strong className="font-mono text-ink">{data.count}</strong> catatan pelanggaran · Halaman{" "}
            <strong className="font-mono text-ink">{data.current_page}</strong> dari{" "}
            <strong className="font-mono text-ink">{data.total_pages}</strong>
          </span>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              icon={ChevronLeft}
            >
              Sebelumnya
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= data.total_pages}
              onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))}
              icon={ChevronRight}
            >
              Selanjutnya
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
