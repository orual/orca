import { isAbsolute } from 'node:path'
import type {
  JjBookmarkMutationInput,
  JjCommitInput,
  JjDescribeInput,
  JjFileDiffInput,
  JjRemoteFetchInput,
  JjRemotePushInput,
  JjWorkspaceAddInput,
  JjWorkspaceRemoveInput
} from '../shared/jj-types'
import { MAX_JJ_STRING_LENGTH } from './jj-handler-context'

export function inputValue(params: Record<string, unknown>): unknown {
  return params.input ?? params
}

export function parseWorkspaceAddInput(value: unknown): JjWorkspaceAddInput {
  const raw = requestRecord(value, 'Invalid jj workspace input.')
  const destination = raw.destination
  const name = raw.name
  const revision = raw.revision
  if (
    typeof destination !== 'string' ||
    !destination ||
    destination.length > MAX_JJ_STRING_LENGTH ||
    destination.includes('\0') ||
    !isAbsolute(destination)
  ) {
    throw new Error('Invalid jj workspace destination.')
  }
  if (name !== undefined && !boundedNonEmptyString(name)) {
    throw new Error('Invalid jj workspace name.')
  }
  if (revision !== undefined && !boundedNonEmptyString(revision)) {
    throw new Error('Invalid jj workspace revision.')
  }
  return {
    destination,
    ...(name !== undefined ? { name: name as string } : {}),
    ...(revision !== undefined ? { revision: revision as string } : {})
  }
}

export function parseWorkspaceRemoveInput(value: unknown): JjWorkspaceRemoveInput {
  const raw = requestRecord(value, 'Invalid jj workspace removal input.')
  if (
    !boundedNonEmptyString(raw.name) ||
    typeof raw.targetRoot !== 'string' ||
    !isAbsolute(raw.targetRoot) ||
    typeof raw.ownerRoot !== 'string' ||
    !isAbsolute(raw.ownerRoot)
  ) {
    throw new Error('Invalid jj workspace removal roots or name.')
  }
  return { name: raw.name as string, targetRoot: raw.targetRoot, ownerRoot: raw.ownerRoot }
}

export function parseFileDiffInput(value: unknown): JjFileDiffInput {
  const raw = requestRecord(value, 'Invalid jj file diff input.')
  if (!isSafeRelativePath(raw.path)) {
    throw new Error('Invalid jj file diff path.')
  }
  if (raw.revision !== undefined && !boundedNonEmptyString(raw.revision)) {
    throw new Error('Invalid jj file diff revision.')
  }
  if (raw.parentRevision !== undefined && !boundedNonEmptyString(raw.parentRevision)) {
    throw new Error('Invalid jj parent revision.')
  }
  return {
    path: raw.path as string,
    ...(raw.revision !== undefined ? { revision: raw.revision as string } : {}),
    ...(raw.parentRevision !== undefined ? { parentRevision: raw.parentRevision as string } : {})
  }
}

export function parseRemoteFetchInput(value: unknown): JjRemoteFetchInput {
  const raw = requestRecord(value, 'Invalid jj remote fetch input.')
  if (!boundedNonEmptyString(raw.remote)) {
    throw new Error('Invalid jj remote name.')
  }
  return { remote: raw.remote as string }
}

export function parseRemotePushInput(value: unknown): JjRemotePushInput {
  const raw = requestRecord(value, 'Invalid jj remote push input.')
  if (!boundedNonEmptyString(raw.remote) || !boundedNonEmptyString(raw.bookmark)) {
    throw new Error('Invalid jj remote or bookmark name.')
  }
  return { remote: raw.remote as string, bookmark: raw.bookmark as string }
}

export function parseDescribeInput(value: unknown): JjDescribeInput {
  const raw = requestRecord(value, 'Invalid jj describe input.')
  if (
    !boundedNonEmptyString(raw.expectedCommitId) ||
    typeof raw.message !== 'string' ||
    raw.message.length > MAX_JJ_STRING_LENGTH * 4 ||
    raw.message.includes('\0')
  ) {
    throw new Error('Invalid jj describe metadata or message.')
  }
  return { expectedCommitId: raw.expectedCommitId as string, message: raw.message }
}

export function parseBookmarkMutationInput(value: unknown): JjBookmarkMutationInput {
  const raw = requestRecord(value, 'Invalid jj bookmark input.')
  if (!boundedNonEmptyString(raw.expectedCommitId) || !boundedNonEmptyString(raw.name)) {
    throw new Error('Invalid jj bookmark metadata or name.')
  }
  return { expectedCommitId: raw.expectedCommitId as string, name: raw.name as string }
}

export function parseCommitInput(value: unknown): JjCommitInput {
  const raw = requestRecord(value, 'Invalid jj commit input.')
  if (!boundedNonEmptyString(raw.expectedCommitId) || !boundedNonEmptyString(raw.message)) {
    throw new Error('Invalid jj commit metadata or message.')
  }
  const rawIntent = requestRecord(raw.intent, 'Invalid jj commit intent.')
  if (rawIntent.kind === 'all') {
    return {
      expectedCommitId: raw.expectedCommitId as string,
      message: raw.message as string,
      intent: { kind: 'all' }
    }
  }
  if (
    rawIntent.kind !== 'selected' ||
    !Array.isArray(rawIntent.paths) ||
    rawIntent.paths.some((path) => !isSafeRelativePath(path))
  ) {
    throw new Error('Invalid jj selected commit paths.')
  }
  return {
    expectedCommitId: raw.expectedCommitId as string,
    message: raw.message as string,
    intent: { kind: 'selected', paths: rawIntent.paths as string[] }
  }
}

function requestRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message)
  }
  return value as Record<string, unknown>
}

function boundedNonEmptyString(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_JJ_STRING_LENGTH &&
    !value.includes('\0')
  )
}

function isSafeRelativePath(value: unknown): boolean {
  if (typeof value !== 'string' || !value || value.length > MAX_JJ_STRING_LENGTH) {
    return false
  }
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.includes('\0')) {
    return false
  }
  const segments = process.platform === 'win32' ? value.split(/[\\/]/) : value.split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}
