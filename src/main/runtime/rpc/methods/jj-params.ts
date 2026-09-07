import { z } from 'zod'
import { WorktreeSelector } from './git-params'

const boundedString = (message: string) =>
  z
    .string()
    .min(1, message)
    .max(8 * 1024)
    .refine((value) => !value.includes('\0'), 'Value contains NUL')

export const JjWorkspaceAdd = WorktreeSelector.extend({
  destination: boundedString('Missing workspace destination'),
  name: boundedString('Workspace name must not be empty').optional(),
  revision: boundedString('Workspace revision must not be empty').optional()
})

export const JjWorkspaceRemove = WorktreeSelector.extend({
  name: boundedString('Missing workspace name'),
  targetRoot: boundedString('Missing workspace target root'),
  ownerRoot: boundedString('Missing workspace owner root')
})

export const JjFileDiff = WorktreeSelector.extend({
  path: boundedString('Missing file path').refine(
    isSafeRelativeJjPath,
    'Invalid relative file path'
  ),
  revision: boundedString('Revision must not be empty').optional(),
  parentRevision: boundedString('Parent revision must not be empty').optional()
})

export const JjCurrentChangeMetadata = WorktreeSelector

export const JjRemoteFetch = WorktreeSelector.extend({
  remote: boundedString('Missing jj remote name')
})

export const JjRemotePush = WorktreeSelector.extend({
  remote: boundedString('Missing jj remote name'),
  bookmark: boundedString('Missing jj bookmark name')
})

export const JjDescribe = WorktreeSelector.extend({
  expectedCommitId: boundedString('Missing expected commit ID'),
  message: z
    .string()
    .max(32 * 1024)
    .refine((value) => !value.includes('\0'), 'Message contains NUL')
})

export const JjBookmarkMutation = WorktreeSelector.extend({
  expectedCommitId: boundedString('Missing expected commit ID'),
  name: boundedString('Missing bookmark name')
})

export const JjCommit = WorktreeSelector.extend({
  expectedCommitId: boundedString('Missing expected commit ID'),
  message: boundedString('Missing commit message'),
  intent: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('all') }),
    z.object({
      kind: z.literal('selected'),
      paths: z.array(
        boundedString('Missing selected path').refine(
          isSafeRelativeJjPath,
          'Invalid relative selected path'
        )
      )
    })
  ])
})

function isSafeRelativeJjPath(value: string): boolean {
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) {
    return false
  }
  const segments = process.platform === 'win32' ? value.split(/[\\/]/) : value.split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}
