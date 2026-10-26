/** Relative time in Indonesian, e.g. "12 dtk lalu". */
export function formatRelative(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'Belum pernah'
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 5) return 'Baru saja'
  if (seconds < 60) return `${seconds} dtk lalu`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} mnt lalu`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} jam lalu`
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatDistance(cm: number | null): string {
  if (cm === null) return '—'
  return `${cm.toLocaleString('id-ID', { maximumFractionDigits: 1 })} cm`
}

export function mapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps?q=${latitude},${longitude}`
}

/** Empty string -> null; anything non-numeric -> null. */
export function parseNumber(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
