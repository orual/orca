import { useCallback, useRef, useState } from 'react'
import { updateRuntimeJjWorkspaceStale } from '@/runtime/runtime-jj-client'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-client'
import { translate } from '@/i18n/i18n'
import type { JjWorkspaceStaleRecoveryResult } from '../../../../../../shared/jj-types'
import type {
  JjChangesPanelContext,
  JjChangesPanelGeneration,
  JjChangesPanelRefresh
} from './jj-changes-panel-state-types'
import { notifyEditorExternalFileChange } from '../../../editor/editor-autosave'

export type StaleRecoveryState = {
  staleRecoveryError: Exclude<JjWorkspaceStaleRecoveryResult, { ok: true }> | null
  isRecoveringStaleWorkspace: boolean
  recoverStaleWorkspace: () => Promise<JjWorkspaceStaleRecoveryResult>
  reset: () => void
}

export function useJjChangesPanelStaleRecovery(
  context: JjChangesPanelContext | null,
  contextGenerationRef: JjChangesPanelGeneration,
  refresh: JjChangesPanelRefresh
): StaleRecoveryState {
  const [staleRecoveryError, setStaleRecoveryError] = useState<Exclude<
    JjWorkspaceStaleRecoveryResult,
    { ok: true }
  > | null>(null)
  const [isRecoveringStaleWorkspace, setIsRecoveringStaleWorkspace] = useState(false)
  const staleRecoveryInFlightRef = useRef<Promise<JjWorkspaceStaleRecoveryResult> | null>(null)
  const reset = useCallback(() => {
    staleRecoveryInFlightRef.current = null
    setStaleRecoveryError(null)
    setIsRecoveringStaleWorkspace(false)
  }, [])

  const recoverStaleWorkspace = useCallback((): Promise<JjWorkspaceStaleRecoveryResult> => {
    if (!context) {
      return Promise.resolve({
        ok: false,
        kind: 'unavailable',
        message: translate(
          'auto.components.right.sidebar.SourceControl.jj.workspaceUnavailable',
          'Jujutsu workspace is unavailable.'
        )
      })
    }
    const current = staleRecoveryInFlightRef.current
    if (current) {
      return current
    }
    const generation = contextGenerationRef.current
    let recoveryPromise!: Promise<JjWorkspaceStaleRecoveryResult>
    recoveryPromise = (async (): Promise<JjWorkspaceStaleRecoveryResult> => {
      setIsRecoveringStaleWorkspace(true)
      setStaleRecoveryError(null)
      try {
        const result = await updateRuntimeJjWorkspaceStale(context)
        if (contextGenerationRef.current !== generation) {
          return {
            ok: false,
            kind: 'uncertain',
            uncertain: true,
            message: 'Jujutsu workspace recovery is uncertain.'
          }
        }
        if (result.ok) {
          setIsRecoveringStaleWorkspace(false)
          notifyEditorExternalFileChange({
            worktreeId: context.worktreeId,
            worktreePath: context.worktreePath,
            relativePath: '',
            runtimeEnvironmentId: context.settings?.activeRuntimeEnvironmentId ?? null,
            workspaceWide: true
          })
          await refresh({ force: true })
          return result
        }
        setIsRecoveringStaleWorkspace(false)
        setStaleRecoveryError(result)
        return result
      } catch (error) {
        const knownPreDispatchFailure =
          error instanceof RuntimeRpcCallError && error.code === 'method_not_found'
        const result: Exclude<JjWorkspaceStaleRecoveryResult, { ok: true }> =
          knownPreDispatchFailure
            ? { ok: false, kind: 'unavailable', message: error.message }
            : {
                ok: false,
                kind: 'uncertain',
                uncertain: true,
                message: `jj workspace recovery outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`
              }
        if (contextGenerationRef.current === generation) {
          setIsRecoveringStaleWorkspace(false)
          setStaleRecoveryError(result)
        }
        return result
      } finally {
        if (staleRecoveryInFlightRef.current === recoveryPromise) {
          staleRecoveryInFlightRef.current = null
        }
      }
    })()
    staleRecoveryInFlightRef.current = recoveryPromise
    return recoveryPromise
  }, [context, contextGenerationRef, refresh])

  return { staleRecoveryError, isRecoveringStaleWorkspace, recoverStaleWorkspace, reset }
}
