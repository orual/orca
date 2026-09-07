import { useCallback, useEffect, useRef, useState } from 'react'
import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import { useAppStore } from '@/store'
import type { JjChange, JjFileDiffResult } from '../../../../../../shared/jj-types'

type FileOpeningState = {
  parentsByPath: Record<string, string[]>
  selectedParentByPath: Record<string, string>
  openingPath: string | null
  readErrorsByPath: Record<string, string>
  openChange: (change: JjChange, parentRevision?: string) => Promise<void>
  selectParent: (change: JjChange, parentRevision: string) => void
}

export function useJjChangesPanelFileOpening(
  worktreeId: string,
  worktreePath: string,
  readDiff: (
    path: string,
    parentRevision?: string,
    options?: { signal?: AbortSignal }
  ) => Promise<JjFileDiffResult>
): FileOpeningState {
  const openFile = useAppStore((s) => s.openFile)
  const [parentsByPath, setParentsByPath] = useState<Record<string, string[]>>({})
  const [selectedParentByPath, setSelectedParentByPath] = useState<Record<string, string>>({})
  const [openingPath, setOpeningPath] = useState<string | null>(null)
  const [readErrorsByPath, setReadErrorsByPath] = useState<Record<string, string>>({})
  const openGenerationRef = useRef(0)
  const openingControllerRef = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      openGenerationRef.current += 1
      openingControllerRef.current?.abort()
      openingControllerRef.current = null
    },
    []
  )

  const openChange = useCallback(
    async (change: JjChange, parentRevision?: string): Promise<void> => {
      const generation = openGenerationRef.current + 1
      openGenerationRef.current = generation
      openingControllerRef.current?.abort()
      const controller = new AbortController()
      openingControllerRef.current = controller
      const selectedParent = parentRevision ?? selectedParentByPath[change.path]
      setOpeningPath(change.path)
      try {
        const result = await readDiff(change.path, selectedParent, { signal: controller.signal })
        if (controller.signal.aborted || openGenerationRef.current !== generation) {
          return
        }
        if (!result.ok) {
          setReadErrorsByPath((current) => ({
            ...current,
            [change.path]: `${result.kind}: ${result.message}`
          }))
          return
        }
        setReadErrorsByPath((current) => {
          if (!(change.path in current)) {
            return current
          }
          const next = { ...current }
          delete next[change.path]
          return next
        })
        if (result.parentDiffs && result.parentDiffs.length > 1 && !selectedParent) {
          setParentsByPath((current) => ({
            ...current,
            [change.path]: result.parentDiffs?.map((parent) => parent.parentRevision) ?? []
          }))
          return
        }
        openFile(
          {
            filePath: joinPath(worktreePath, change.path),
            relativePath: change.path,
            worktreeId,
            language: detectLanguage(change.path),
            mode: 'diff',
            diffSource: 'jj',
            jjParentRevision: selectedParent
          },
          { preview: false }
        )
      } catch (error) {
        if (controller.signal.aborted || openGenerationRef.current !== generation) {
          return
        }
        setReadErrorsByPath((current) => ({
          ...current,
          [change.path]: error instanceof Error ? error.message : String(error)
        }))
      } finally {
        if (openGenerationRef.current === generation) {
          setOpeningPath(null)
          openingControllerRef.current = null
        }
      }
    },
    [openFile, readDiff, selectedParentByPath, worktreeId, worktreePath]
  )

  const selectParent = useCallback(
    (change: JjChange, parentRevision: string): void => {
      setSelectedParentByPath((current) => ({
        ...current,
        [change.path]: parentRevision
      }))
      setParentsByPath((current) => ({ ...current, [change.path]: [] }))
      void openChange(change, parentRevision)
    },
    [openChange]
  )

  return {
    parentsByPath,
    selectedParentByPath,
    openingPath,
    readErrorsByPath,
    openChange,
    selectParent
  }
}
