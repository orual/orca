import type { JjFileDiffInput, JjFileDiffResult } from '../../shared/jj-types'
import { normalizeJjRelativePath } from './runtime-jj-inputs'
import {
  runRuntimeJj,
  type RuntimeJjCommandHost,
  type RuntimeJjRequestOptions
} from './runtime-jj-operation-context'

export function readRuntimeJjFileDiff(
  host: RuntimeJjCommandHost,
  selector: string,
  input: JjFileDiffInput,
  options?: RuntimeJjRequestOptions
): Promise<JjFileDiffResult> {
  return runRuntimeJj(host, selector, options, (route, target) => {
    const normalizedInput = { ...input, path: normalizeJjRelativePath(input.path) }
    return route.kind === 'local'
      ? route.backend.readFileDiff(normalizedInput)
      : route.provider.readFileDiff(target.worktree.path, normalizedInput, options)
  })
}
