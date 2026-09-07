import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { getConnectionId } from '@/lib/connection-context'
import { getRepoOwnerRoutedSettings } from '@/lib/repo-runtime-owner'
import { installWindowVisibilityTimeoutPoller } from '@/lib/window-visibility-timeout-poller'
import { normalizeRuntimePathForComparison } from '../../../../shared/cross-platform-path'
import { isJjRepo } from '../../../../shared/repo-kind'
import type { JjChangesResult } from '../../../../shared/jj-types'
import type { GitStatusEntry } from '../../../../shared/git-status-types'
import { listRuntimeJjChanges } from '@/runtime/runtime-jj-client'
import type { Repo } from '../../../../shared/repo-types'
import { ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT } from '../editor/editor-autosave'
import { normalizeJjChange } from './status-display'

export type JjExplorerStatus = {
  entries: GitStatusEntry[]
  refresh: (force?: boolean) => Promise<void>
}

export function useJjExplorerStatus(
  activeRepo: Repo | null,
  activeWorktreeId: string | null,
  worktreePath: string | null
): JjExplorerStatus {
  const settings = useAppStore((s) => s.settings)
  const [entries, setEntries] = useState<GitStatusEntry[]>([])
  const context = useMemo(() => {
    if (
      !isJjRepo(activeRepo ?? { kind: 'git' }) ||
      !activeRepo ||
      !activeWorktreeId ||
      !worktreePath
    ) {
      return null
    }
    return {
      settings: getRepoOwnerRoutedSettings(settings, activeRepo),
      worktreeId: activeWorktreeId,
      worktreePath,
      connectionId: getConnectionId(activeWorktreeId) ?? undefined
    }
  }, [activeRepo, activeWorktreeId, settings, worktreePath])
  const contextKey = context
    ? JSON.stringify([
        context.worktreeId,
        normalizeRuntimePathForComparison(context.worktreePath),
        context.connectionId ?? '',
        context.settings?.activeRuntimeEnvironmentId ?? ''
      ])
    : 'unavailable'
  const requestRef = useRef<{
    key: string
    generation: number
    controller: AbortController
    promise: Promise<void>
  } | null>(null)
  const generationRef = useRef(0)
  const refresh = useCallback(
    (force = false): Promise<void> => {
      if (!context) {
        setEntries([])
        return Promise.resolve()
      }
      if (requestRef.current?.key === contextKey && !force) {
        return requestRef.current.promise
      }
      requestRef.current?.controller.abort()
      const generation = generationRef.current
      const controller = new AbortController()
      const request: {
        key: string
        generation: number
        controller: AbortController
        promise: Promise<void>
      } = { key: contextKey, generation, controller, promise: Promise.resolve() }
      const promise = (async (): Promise<void> => {
        try {
          const result: JjChangesResult = await listRuntimeJjChanges(context, {
            signal: controller.signal
          })
          if (
            controller.signal.aborted ||
            generationRef.current !== generation ||
            requestRef.current !== request
          ) {
            return
          }
          if (result.ok) {
            setEntries(result.changes.map(normalizeJjChange))
          }
        } catch {
          // Keep the last successful snapshot; an unavailable host is not a clean tree.
        } finally {
          if (requestRef.current === request) {
            requestRef.current = null
          }
        }
      })()
      request.promise = promise
      requestRef.current = request
      return promise
    },
    [context, contextKey]
  )
  useEffect(() => {
    generationRef.current += 1
    requestRef.current?.controller.abort()
    requestRef.current = null
    if (!context) {
      setEntries([])
      return
    }
    void refresh()
    const stopPolling = installWindowVisibilityTimeoutPoller({
      run: () => refresh(),
      getDelayMs: () => 5_000
    })
    return () => {
      generationRef.current += 1
      requestRef.current?.controller.abort()
      requestRef.current = null
      stopPolling()
    }
  }, [context, contextKey, refresh])
  useEffect(() => {
    if (!context || typeof window === 'undefined') {
      return
    }
    const handleFileChange = (event: Event): void => {
      const detail = (event as CustomEvent<{ worktreeId?: string; worktreePath?: string }>).detail
      if (
        detail?.worktreeId === context.worktreeId &&
        (!detail.worktreePath ||
          normalizeRuntimePathForComparison(detail.worktreePath) ===
            normalizeRuntimePathForComparison(context.worktreePath))
      ) {
        void refresh(true)
      }
    }
    window.addEventListener(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, handleFileChange)
    return () =>
      window.removeEventListener(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, handleFileChange)
  }, [context, refresh])
  return { entries, refresh }
}
