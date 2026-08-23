import { devicesApi } from '@/services/api'
import { usePolling } from '@/hooks/usePolling'

export function useDevices(intervalMs = 3000) {
  return usePolling(devicesApi.list, intervalMs)
}
