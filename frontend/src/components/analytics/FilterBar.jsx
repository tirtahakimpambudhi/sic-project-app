import { useEffect, useRef, useState } from "react";
import { Calendar, Check, ChevronDown, RotateCw } from "lucide-react";
import Button from "../Button.jsx";
import { getDatePreset } from "../../utils/analytics.js";

export default function FilterBar({
  filters,
  onFiltersChange,
  devices = [],
  onRefresh,
  loading = false,
}) {
  const [deviceDropdownOpen, setDeviceDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDeviceDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handlePreset = (days) => {
    const preset = getDatePreset(days);
    onFiltersChange({
      ...filters,
      start: preset.start,
      end: preset.end,
    });
  };

  const handleDeviceToggle = (deviceId) => {
    const current = Array.isArray(filters.device)
      ? [...filters.device]
      : filters.device
      ? [filters.device]
      : [];

    const index = current.indexOf(deviceId);
    if (index >= 0) {
      current.splice(index, 1);
    } else {
      current.push(deviceId);
    }

    onFiltersChange({
      ...filters,
      device: current,
    });
  };

  const handleSelectAllDevices = () => {
    onFiltersChange({
      ...filters,
      device: [], // empty = all devices
    });
  };

  const isAllDevices = !filters.device || filters.device.length === 0;
  const selectedCount = Array.isArray(filters.device) ? filters.device.length : filters.device ? 1 : 0;

  return (
    <div className="panel p-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        {/* Left: Filter Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Preset Buttons */}
          <div className="flex items-center rounded-control border border-line bg-surface p-1">
            <button
              type="button"
              onClick={() => handlePreset(7)}
              className="rounded-control px-2.5 py-1 text-xs font-semibold text-muted hover:bg-sunken hover:text-ink transition-colors"
            >
              7 Hari
            </button>
            <button
              type="button"
              onClick={() => handlePreset(14)}
              className="rounded-control px-2.5 py-1 text-xs font-semibold text-muted hover:bg-sunken hover:text-ink transition-colors"
            >
              14 Hari
            </button>
            <button
              type="button"
              onClick={() => handlePreset(30)}
              className="rounded-control px-2.5 py-1 text-xs font-semibold text-muted hover:bg-sunken hover:text-ink transition-colors"
            >
              30 Hari
            </button>
          </div>

          {/* Date Range Inputs */}
          <div className="flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-1.5 text-sm">
            <Calendar className="h-4 w-4 text-muted" aria-hidden />
            <input
              type="date"
              value={filters.start}
              onChange={(e) => onFiltersChange({ ...filters, start: e.target.value })}
              className="bg-transparent text-xs font-mono text-ink focus:outline-none"
              aria-label="Tanggal mulai"
            />
            <span className="text-muted text-xs">s/d</span>
            <input
              type="date"
              value={filters.end}
              onChange={(e) => onFiltersChange({ ...filters, end: e.target.value })}
              className="bg-transparent text-xs font-mono text-ink focus:outline-none"
              aria-label="Tanggal akhir"
            />
          </div>

          {/* Multi-select Perangkat Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDeviceDropdownOpen((o) => !o)}
              className="flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-sunken transition-colors"
              aria-haspopup="listbox"
              aria-expanded={deviceDropdownOpen}
            >
              <span>
                {isAllDevices
                  ? "Semua Titik Lokasi"
                  : `${selectedCount} Lokasi Dipilih`}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted" aria-hidden />
            </button>

            {deviceDropdownOpen && (
              <div
                className="absolute left-0 top-full z-50 mt-1 max-h-60 w-64 overflow-y-auto rounded-control border border-line bg-surface p-2 shadow-lg"
                role="listbox"
              >
                <button
                  type="button"
                  onClick={handleSelectAllDevices}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-ink hover:bg-sunken text-left"
                >
                  <span className="font-semibold">Semua Titik Lokasi</span>
                  {isAllDevices && <Check className="h-3.5 w-3.5 text-accent-text" />}
                </button>
                <div className="my-1 border-t border-line" />
                {devices.map((dev) => {
                  const isChecked =
                    Array.isArray(filters.device) && filters.device.includes(dev.device_id);
                  return (
                    <button
                      key={dev.device_id}
                      type="button"
                      onClick={() => handleDeviceToggle(dev.device_id)}
                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-ink hover:bg-sunken text-left"
                    >
                      <div className="min-w-0 pr-2">
                        <p className="truncate font-medium">{dev.name}</p>
                        <p className="text-[11px] font-mono text-muted">
                          {dev.latitude?.toFixed(4)}, {dev.longitude?.toFixed(4)}
                        </p>
                      </div>
                      {isChecked && <Check className="h-3.5 w-3.5 shrink-0 text-accent-text" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: Refresh button & Timezone note */}
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted">Zona Waktu: WIB (Jakarta)</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            icon={RotateCw}
            className={loading ? "opacity-75" : ""}
          >
            {loading ? "Menyegarkan..." : "Segarkan data"}
          </Button>
        </div>
      </div>
    </div>
  );
}
