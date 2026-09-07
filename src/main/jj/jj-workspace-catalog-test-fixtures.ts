import { vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type { Store } from '../persistence'

export const repo = (overrides: Partial<Repo> = {}): Repo => ({
  id: 'repo-1',
  path: '/repo',
  displayName: 'repo',
  badgeColor: 'blue',
  addedAt: 1,
  kind: 'jj',
  executionHostId: 'local',
  ...overrides
})

export const store = (
  rows: Record<string, unknown> = {},
  hostRows: Record<string, unknown> = {}
) => {
  const metadata = { ...rows }
  const hostMetadata = { ...hostRows }
  return {
    getRepos: () => [repo()],
    getAllWorktreeMeta: () => metadata,
    getSettings: () => ({
      worktreeVisibilityDefaults: {},
      workspaceDir: '/tmp/orca-workspaces',
      nestWorkspaces: false
    }),
    getAllWorktreeLineage: () => ({}),
    getWorktreeMeta: (id: string) => metadata[id],
    ...(Object.keys(hostRows).length > 0
      ? {
          getWorktreeMetaForHost: (id: string, hostId: string) => {
            const qualified = hostMetadata[`${hostId}:${id}`]
            const legacy = metadata[id] as { hostId?: string } | undefined
            return (
              qualified ??
              (legacy && (!legacy.hostId || legacy.hostId === hostId) ? legacy : undefined)
            )
          },
          setWorktreeMetaForHost: vi.fn((id: string, hostId: string, updates) => {
            const key = `${hostId}:${id}`
            hostMetadata[key] = {
              ...(hostMetadata[key] as Record<string, unknown> | undefined),
              ...updates,
              hostId
            }
            return hostMetadata[key]
          })
        }
      : {}),
    setWorktreeMeta: vi.fn((id, updates) => {
      metadata[id] = { ...(metadata[id] as Record<string, unknown> | undefined), ...updates }
      return metadata[id]
    }),
    removeWorktreeMeta: vi.fn()
  } as unknown as Store
}
