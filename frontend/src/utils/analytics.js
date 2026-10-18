export const DAYS_ID = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

const numberFormat = new Intl.NumberFormat("id-ID");
const percentFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

export function formatNumber(val, fallback = "0") {
  if (val === null || val === undefined || isNaN(val)) return fallback;
  return numberFormat.format(val);
}

export function formatPercent(val, fallback = "0%") {
  if (val === null || val === undefined || isNaN(val)) return fallback;
  return `${percentFormat.format(val)}%`;
}

export function formatMinutes(minutes, fallback = "-") {
  if (minutes === null || minutes === undefined || isNaN(minutes)) return fallback;
  if (minutes < 1) {
    const sec = Math.round(minutes * 60);
    return `${sec} dtk`;
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remMin = Math.round(minutes % 60);
    return remMin > 0 ? `${hours} jam ${remMin} mnt` : `${hours} jam`;
  }
  return `${percentFormat.format(minutes)} mnt`;
}

export function formatLocationSubtitle(locations) {
  if (!locations || locations.length === 0) {
    return "Lokasi: Semua perangkat terpilih";
  }
  const maxShown = 3;
  const shown = locations.slice(0, maxShown);
  const remaining = locations.length - maxShown;

  const parts = shown.map((loc) => {
    const name = loc.lokasi || loc.name || "Perangkat";
    const coord = loc.koordinat || (loc.latitude && loc.longitude ? `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}` : "-");
    return `${name} (${coord})`;
  });

  let text = `Lokasi: ${parts.join("; ")}`;
  if (remaining > 0) {
    text += ` (+${remaining} lokasi lain)`;
  }
  return text;
}

export function getTodayWib() {
  const now = new Date();
  // UTC+7 (Asia/Jakarta)
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 3600000 * 7);
}

export function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getDatePreset(days) {
  const today = getTodayWib();
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  return {
    start: toDateString(start),
    end: toDateString(today),
  };
}

export function formatWibDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }) + " WIB";
}

export function formatWibDate(isoOrDateStr) {
  if (!isoOrDateStr) return "-";
  const parts = isoOrDateStr.split("-");
  if (parts.length === 3) {
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  }
  return new Date(isoOrDateStr).toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
