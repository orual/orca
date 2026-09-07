import { useCallback, useRef, useState } from 'react'
import { fetchRuntimeJjRemote, pushRuntimeJjBookmark } from '@/runtime/runtime-jj-client'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-client'
import { translate } from '@/i18n/i18n'
import type {
  JjRemoteFetchInput,
  JjRemoteFetchResult,
  JjRemotePushInput,
  JjRemotePushResult
} from '../../../../../../shared/jj-types'
import type {
  InFlightRemoteMutation,
  JjChangesPanelContext,
  JjChangesPanelGeneration,
  JjChangesPanelRefresh
} from './jj-changes-panel-state-types'

type RemoteMutationState = {
  isRemoteMutating: boolean
  remoteError: Exclude<JjRemoteFetchResult | JjRemotePushResult, { ok: true }> | null
  fetchRemote: (input: JjRemoteFetchInput) => Promise<JjRemoteFetchResult>
  pushBookmark: (input: JjRemotePushInput) => Promise<JjRemotePushResult>
  reset: () => void
}

export function useJjChangesPanelRemoteMutations(
  context: JjChangesPanelContext | null,
  contextKey: string,
  contextGenerationRef: JjChangesPanelGeneration,
  refresh: JjChangesPanelRefresh
): RemoteMutationState {
  const [isRemoteMutating, setIsRemoteMutating] = useState(false)
  const [remoteError, setRemoteError] = useState<Exclude<
    JjRemoteFetchResult | JjRemotePushResult,
    { ok: true }
  > | null>(null)
  const inFlightRemoteMutationRef = useRef<InFlightRemoteMutation | null>(null)
  const reset = useCallback(() => {
    inFlightRemoteMutationRef.current = null
    setRemoteError(null)
    setIsRemoteMutating(false)
  }, [])

  const runRemoteMutation = useCallback(
    <TResult extends JjRemoteFetchResult | JjRemotePushResult>(
      operation: (mutationContext: JjChangesPanelContext) => Promise<TResult>
    ): Promise<TResult> => {
      if (!context) {
        return Promise.resolve({
          ok: false,
          kind: 'unavailable',
          message: translate(
            'auto.components.right.sidebar.SourceControl.jj.workspaceUnavailable',
            'Jujutsu workspace is unavailable.'
          )
        } as TResult)
      }
      const current = inFlightRemoteMutationRef.current
      if (
        current?.contextKey === contextKey &&
        current.generation === contextGenerationRef.current
      ) {
        return current.promise as Promise<TResult>
      }
      const generation = contextGenerationRef.current
      let remotePromise!: Promise<TResult>
      remotePromise = (async (): Promise<TResult> => {
        setIsRemoteMutating(true)
        setRemoteError(null)
        try {
          const result = await operation(context)
          if (contextGenerationRef.current !== generation) {
            return {
              ok: false,
              kind: 'stale',
              message: 'The Jujutsu workspace changed.'
            } as TResult
          }
          if (result.ok) {
            setIsRemoteMutating(false)
            await refresh({ force: true })
          } else {
            setIsRemoteMutating(false)
            setRemoteError(result as Exclude<TResult, { ok: true }>)
          }
          return result
        } catch (error) {
          const knownPreDispatchFailure =
            error instanceof RuntimeRpcCallError && error.code === 'method_not_found'
          const result = (
            knownPreDispatchFailure
              ? { ok: false, kind: 'unavailable', message: error.message }
              : {
                  ok: false,
                  kind: 'uncertain',
                  uncertain: true,
                  message: `jj remote operation outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`
                }
          ) as TResult
          if (contextGenerationRef.current === generation) {
            setIsRemoteMutating(false)
            setRemoteError(result as Exclude<TResult, { ok: true }>)
          }
          return result
        } finally {
          if (inFlightRemoteMutationRef.current?.promise === remotePromise) {
            inFlightRemoteMutationRef.current = null
          }
        }
      })()
      inFlightRemoteMutationRef.current = {
        contextKey,
        generation,
        promise: remotePromise as Promise<JjRemoteFetchResult | JjRemotePushResult>
      }
      return remotePromise
    },
    [context, contextGenerationRef, contextKey, refresh]
  )

  const fetchRemote = useCallback(
    (input: JjRemoteFetchInput): Promise<JjRemoteFetchResult> =>
      runRemoteMutation((mutationContext) => fetchRuntimeJjRemote(mutationContext, input)),
    [runRemoteMutation]
  )
  const pushBookmark = useCallback(
    (input: JjRemotePushInput): Promise<JjRemotePushResult> =>
      runRemoteMutation((mutationContext) => pushRuntimeJjBookmark(mutationContext, input)),
    [runRemoteMutation]
  )

  return { isRemoteMutating, remoteError, fetchRemote, pushBookmark, reset }
}
