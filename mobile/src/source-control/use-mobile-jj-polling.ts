import { AppState } from 'react-native'
import { useCallback, useEffect, useRef } from 'react'
import { useFocusEffect } from 'expo-router'

const POLL_INTERVAL_MS = 2_000

export function useMobileJjPolling(
  refresh: () => Promise<boolean>,
  canPoll: () => boolean = () => true
): void {
  const focusedRef = useRef(false)
  const appActiveRef = useRef(true)

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true
      void refresh()
      return () => {
        focusedRef.current = false
      }
    }, [refresh])
  )

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      appActiveRef.current = state === 'active'
      if (focusedRef.current && appActiveRef.current) {
        void refresh()
      }
    })
    const timer = setInterval(() => {
      if (focusedRef.current && appActiveRef.current && canPoll()) {
        void refresh()
      }
    }, POLL_INTERVAL_MS)
    return () => {
      subscription.remove()
      clearInterval(timer)
    }
  }, [refresh])
}
