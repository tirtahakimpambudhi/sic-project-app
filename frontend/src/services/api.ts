import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type {
  AlertData,
  AuthTokens,
  CommandAccepted,
  CreateDevicePayload,
  Device,
  GeneralConfigPayload,
  SetConfigPayload,
  TelemetryData,
  UnsetConfigPayload,
  UpdateDevicePayload,
  User,
} from '@/types'

const BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api'
const TOKEN_KEY = 'slop.tokens'
export const UNAUTHORIZED_EVENT = 'slop:unauthorized'

export const tokenStore = {
  get(): AuthTokens | null {
    const raw = localStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as AuthTokens
    } catch {
      return null
    }
  },
  set(tokens: AuthTokens): void {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens))
  },
  clear(): void {
    localStorage.removeItem(TOKEN_KEY)
  },
}

export const http = axios.create({ baseURL: BASE_URL })

http.interceptors.request.use((config) => {
  const tokens = tokenStore.get()
  if (tokens) config.headers.Authorization = `Bearer ${tokens.access}`
  return config
})

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean }
let refreshInFlight: Promise<string> | null = null

/** One refresh request shared by every call that hit 401 at the same time. */
function refreshAccessToken(refresh: string): Promise<string> {
  refreshInFlight ??= axios
    .post<{ access: string }>(`${BASE_URL}/auth/token/refresh/`, { refresh })
    .then(({ data }) => {
      tokenStore.set({ access: data.access, refresh })
      return data.access
    })
    .finally(() => {
      refreshInFlight = null
    })
  return refreshInFlight
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined
    const tokens = tokenStore.get()
    const isAuthCall = config?.url?.includes('/auth/token')
    if (error.response?.status === 401 && config && !config._retried && tokens && !isAuthCall) {
      config._retried = true
      try {
        const access = await refreshAccessToken(tokens.refresh)
        config.headers.Authorization = `Bearer ${access}`
        return http(config)
      } catch {
        tokenStore.clear()
        window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
      }
    }
    return Promise.reject(error)
  },
)

// ---- error messages ----------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function flattenErrors(data: unknown): string | null {
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return data.map(flattenErrors).filter(Boolean).join(' ')
  if (isRecord(data)) {
    if (typeof data.detail === 'string') return data.detail
    const parts = Object.entries(data)
      .map(([field, value]) => {
        const message = flattenErrors(value)
        return message ? `${field}: ${message}` : null
      })
      .filter((part): part is string => part !== null)
    return parts.length ? parts.join(' · ') : null
  }
  return null
}

/** Turns any thrown value into a message that is safe to show to the user. */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) return 'Tidak dapat menghubungi server. Periksa koneksi Anda.'
    return flattenErrors(error.response.data) ?? `Permintaan gagal (${error.response.status}).`
  }
  return error instanceof Error ? error.message : 'Terjadi kesalahan.'
}

// ---- endpoints ---------------------------------------------------------------------------

export const authApi = {
  async login(username: string, password: string): Promise<AuthTokens> {
    const { data } = await http.post<AuthTokens>('/auth/token/', { username, password })
    return data
  },
  async me(): Promise<User> {
    const { data } = await http.get<User>('/auth/me/')
    return data
  },
}

export const devicesApi = {
  async list(): Promise<Device[]> {
    return (await http.get<Device[]>('/devices/')).data
  },
  async create(payload: CreateDevicePayload): Promise<Device> {
    return (await http.post<Device>('/devices/', payload)).data
  },
  async update(id: number, payload: UpdateDevicePayload): Promise<Device> {
    return (await http.patch<Device>(`/devices/${id}/`, payload)).data
  },
  async remove(id: number): Promise<void> {
    await http.delete(`/devices/${id}/`)
  },
  async addUnit(id: number, payload: SetConfigPayload): Promise<CommandAccepted> {
    return (await http.post<CommandAccepted>(`/devices/${id}/units/`, payload)).data
  },
  async removeUnits(id: number, payload: UnsetConfigPayload): Promise<CommandAccepted> {
    return (await http.post<CommandAccepted>(`/devices/${id}/units/unset/`, payload)).data
  },
  async updateGeneral(id: number, payload: GeneralConfigPayload): Promise<CommandAccepted> {
    return (await http.post<CommandAccepted>(`/devices/${id}/general/`, payload)).data
  },
  async telemetry(id: number, params?: { unit_id?: number; limit?: number }): Promise<TelemetryData[]> {
    return (await http.get<TelemetryData[]>(`/devices/${id}/telemetry/`, { params })).data
  },
}

export const alertsApi = {
  async list(params?: { resolved?: boolean; limit?: number }): Promise<AlertData[]> {
    return (await http.get<AlertData[]>('/alerts/', { params })).data
  },
  async resolve(id: number): Promise<AlertData> {
    return (await http.post<AlertData>(`/alerts/${id}/resolve/`)).data
  },
}
