import { useCallback } from 'react'
import { alertsApi } from '@/services/api'
import { usePolling } from '@/hooks/usePolling'

export type AlertFilter = 'active' | 'all'

export function useAlerts(filter: AlertFilter, intervalMs = 3000) {
  const fetcher = useCallback(
    () => alertsApi.list({ resolved: filter === 'active' ? false : undefined, limit: 50 }),
    [filter],
  )
  return usePolling(fetcher, intervalMs)
}
