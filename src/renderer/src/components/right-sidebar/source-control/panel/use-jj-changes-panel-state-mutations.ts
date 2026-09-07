import { useCallback, useRef, useState } from 'react'
import {
  commitRuntimeJj,
  createRuntimeJjBookmark,
  describeRuntimeJjCurrentChange,
  moveRuntimeJjBookmark
} from '@/runtime/runtime-jj-client'
import type {
  JjBookmarkMutationInput,
  JjBookmarkMutationResult,
  JjCommitInput,
  JjCommitResult,
  JjDescribeInput,
  JjDescribeResult
} from '../../../../../../shared/jj-types'
import { translate } from '@/i18n/i18n'
import type {
  InFlightCommit,
  InFlightJjMutation,
  JjChangesPanelContext,
  JjChangesPanelGeneration,
  JjChangesPanelRefresh
} from './jj-changes-panel-state-types'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-client'

type MutationResult = JjDescribeResult | JjBookmarkMutationResult

type CommitMutationState = {
  reset: () => void
  commitError: Exclude<JjCommitResult, { ok: true }> | null
  isCommitting: boolean
  mutationError: Exclude<MutationResult, { ok: true }> | null
  isMutating: boolean
  commit: (input: JjCommitInput) => Promise<JjCommitResult>
  describe: (input: JjDescribeInput) => Promise<JjDescribeResult>
  createBookmark: (input: JjBookmarkMutationInput) => Promise<JjBookmarkMutationResult>
  moveBookmark: (input: JjBookmarkMutationInput) => Promise<JjBookmarkMutationResult>
}

export function useJjChangesPanelCommitMutations(
  context: JjChangesPanelContext | null,
  contextKey: string,
  contextGenerationRef: JjChangesPanelGeneration,
  refresh: JjChangesPanelRefresh
): CommitMutationState {
  const [commitError, setCommitError] = useState<Exclude<JjCommitResult, { ok: true }> | null>(null)
  const [isCommitting, setIsCommitting] = useState(false)
  const [mutationError, setMutationError] = useState<Exclude<MutationResult, { ok: true }> | null>(
    null
  )
  const [isMutating, setIsMutating] = useState(false)
  const inFlightCommitRef = useRef<InFlightCommit | null>(null)
  const inFlightMutationRef = useRef<InFlightJjMutation | null>(null)
  const reset = useCallback(() => {
    inFlightCommitRef.current = null
    inFlightMutationRef.current = null
    setCommitError(null)
    setMutationError(null)
    setIsMutating(false)
    setIsCommitting(false)
  }, [])

  const commit = useCallback(
    (input: JjCommitInput): Promise<JjCommitResult> => {
      if (!context) {
        return Promise.resolve(unavailableResult<JjCommitResult>())
      }
      const current = inFlightCommitRef.current
      if (
        current?.contextKey === contextKey &&
        current.generation === contextGenerationRef.current
      ) {
        return current.promise
      }
      const generation = contextGenerationRef.current
      let commitPromise!: Promise<JjCommitResult>
      commitPromise = (async (): Promise<JjCommitResult> => {
        setIsCommitting(true)
        setCommitError(null)
        try {
          const result = await commitRuntimeJj(context, input)
          if (contextGenerationRef.current !== generation) {
            return { ok: false, kind: 'stale', message: 'The Jujutsu workspace changed.' }
          }
          if (result.ok) {
            setIsCommitting(false)
            await refresh({ force: true })
          } else {
            setIsCommitting(false)
            setCommitError(result)
          }
          return result
        } catch (error) {
          const knownPreDispatchFailure =
            error instanceof RuntimeRpcCallError && error.code === 'method_not_found'
          const result: JjCommitResult = knownPreDispatchFailure
            ? { ok: false, kind: 'error', message: error.message }
            : {
                ok: false,
                kind: 'uncertain',
                uncertain: true,
                message: `jj commit outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`
              }
          if (contextGenerationRef.current === generation) {
            setIsCommitting(false)
            setCommitError(result)
          }
          return result
        } finally {
          if (inFlightCommitRef.current?.promise === commitPromise) {
            inFlightCommitRef.current = null
          }
        }
      })()
      inFlightCommitRef.current = { contextKey, generation, promise: commitPromise }
      return commitPromise
    },
    [context, contextGenerationRef, contextKey, refresh]
  )

  const runMutation = useCallback(
    (
      operation: (context: JjChangesPanelContext, input: MutationInput) => Promise<MutationResult>,
      input: MutationInput
    ): Promise<MutationResult> => {
      if (!context) {
        return Promise.resolve(unavailableResult<MutationResult>())
      }
      const current = inFlightMutationRef.current
      if (
        current?.contextKey === contextKey &&
        current.generation === contextGenerationRef.current
      ) {
        return current.promise
      }
      const generation = contextGenerationRef.current
      let mutationPromise!: Promise<MutationResult>
      mutationPromise = (async (): Promise<MutationResult> => {
        setIsMutating(true)
        setMutationError(null)
        try {
          const result = await operation(context, input)
          if (contextGenerationRef.current !== generation) {
            return { ok: false, kind: 'stale', message: 'The Jujutsu workspace changed.' }
          }
          if (result.ok) {
            setIsMutating(false)
            await refresh({ force: true })
          } else {
            setIsMutating(false)
            setMutationError(result)
          }
          return result
        } catch (error) {
          const knownPreDispatchFailure =
            error instanceof RuntimeRpcCallError && error.code === 'method_not_found'
          const result: MutationResult = knownPreDispatchFailure
            ? { ok: false, kind: 'error', message: error.message }
            : {
                ok: false,
                kind: 'uncertain',
                uncertain: true,
                message: `jj mutation outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`
              }
          if (contextGenerationRef.current === generation) {
            setIsMutating(false)
            setMutationError(result)
          }
          return result
        } finally {
          if (inFlightMutationRef.current?.promise === mutationPromise) {
            inFlightMutationRef.current = null
          }
        }
      })()
      inFlightMutationRef.current = { contextKey, generation, promise: mutationPromise }
      return mutationPromise
    },
    [context, contextGenerationRef, contextKey, refresh]
  )

  const describe = useCallback(
    (input: JjDescribeInput): Promise<JjDescribeResult> =>
      runMutation(
        (mutationContext, mutationInput) =>
          describeRuntimeJjCurrentChange(mutationContext, mutationInput as JjDescribeInput),
        input
      ).then((result) => result as JjDescribeResult),
    [runMutation]
  )
  const createBookmark = useCallback(
    (input: JjBookmarkMutationInput): Promise<JjBookmarkMutationResult> =>
      runMutation(
        (mutationContext, mutationInput) =>
          createRuntimeJjBookmark(mutationContext, mutationInput as JjBookmarkMutationInput),
        input
      ).then((result) => result as JjBookmarkMutationResult),
    [runMutation]
  )
  const moveBookmark = useCallback(
    (input: JjBookmarkMutationInput): Promise<JjBookmarkMutationResult> =>
      runMutation(
        (mutationContext, mutationInput) =>
          moveRuntimeJjBookmark(mutationContext, mutationInput as JjBookmarkMutationInput),
        input
      ).then((result) => result as JjBookmarkMutationResult),
    [runMutation]
  )

  return {
    reset,
    commitError,
    isCommitting,
    mutationError,
    isMutating,
    commit,
    describe,
    createBookmark,
    moveBookmark
  }
}

function unavailableResult<TResult>(): TResult {
  return {
    ok: false,
    kind: 'unavailable',
    message: translate(
      'auto.components.right.sidebar.SourceControl.jj.workspaceUnavailable',
      'Jujutsu workspace is unavailable.'
    )
  } as TResult
}
