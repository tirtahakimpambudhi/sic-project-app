import { useCallback, useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@/services/api'

interface PollingResult<T> {
  data: T | null
  error: string | null
  /** True only until the first response; later refreshes keep showing the previous data. */
  loading: boolean
  refresh: () => Promise<void>
}

/** Calls `fetcher` now and every `intervalMs` while the tab is visible. */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number): PollingResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fetcherRef = useRef(fetcher)
  const mountedRef = useRef(true)

  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const refresh = useCallback(async () => {
    try {
      const next = await fetcherRef.current()
      if (!mountedRef.current) return
      setData(next)
      setError(null)
    } catch (caught) {
      if (mountedRef.current) setError(getErrorMessage(caught))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    const id = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, intervalMs)
    return () => {
      mountedRef.current = false
      window.clearInterval(id)
    }
  }, [refresh, intervalMs])

  return { data, error, loading, refresh }
}
