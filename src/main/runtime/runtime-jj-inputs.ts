import { isWindowsAbsolutePathLike } from '../../shared/cross-platform-path'
import { parseWslUncPath, toLinuxPath } from '../../shared/wsl-paths'
import type { JjWorkspaceAddInput } from '../../shared/jj-types'
import type { RuntimeJjRoute } from './runtime-jj-command-target'

export function normalizeJjRelativePath(path: string): string {
  if (!path || path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) {
    throw new Error('invalid_relative_path')
  }
  const segments = path.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('invalid_relative_path')
  }
  return path
}

export function normalizeWorkspaceAddInput(
  input: JjWorkspaceAddInput,
  route: RuntimeJjRoute
): JjWorkspaceAddInput {
  if (route.kind !== 'local' || route.target !== 'wsl' || !route.wslDistro) {
    return input
  }
  const parsed = parseWslUncPath(input.destination)
  if (parsed) {
    if (parsed.distro.toLowerCase() !== route.wslDistro.toLowerCase()) {
      throw new Error('jj_workspace_destination_distro_mismatch')
    }
    return { ...input, destination: parsed.linuxPath }
  }
  if (input.destination.startsWith('\\\\') || input.destination.startsWith('//')) {
    throw new Error('jj_workspace_destination_unmappable')
  }
  if (isWindowsAbsolutePathLike(input.destination)) {
    return { ...input, destination: toLinuxPath(input.destination) }
  }
  return input
}
