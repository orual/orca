import type { RpcResponse } from './mock-server-rpc-handlers'
import { jjFixture } from './mock-server-jj-mutation-fixture'

type Respond = (response: RpcResponse) => void
type Success = (id: string, result: unknown) => RpcResponse

export function handleMockJjWorkspaceRequest(
  request: { method: string; id: string; params?: Record<string, unknown> },
  respond: Respond,
  success: Success
): boolean {
  const { method, id, params } = request
  const worktreeId = 'repo-jj::/tmp/orca-mobile-repro/jj-mobile/workspaces/mobile-review'
  const root = '/tmp/orca-mobile-repro/jj-mobile/workspaces/mobile-review'
  const repositoryIdentity = '/tmp/orca-mobile-repro/jj-mobile/.jj/repo'
  const workspacePresent = jjFixture

  if (method === 'worktree.rm') {
    const selector =
      typeof params?.worktree === 'string' ? params.worktree.replace(/^id:/, '') : worktreeId
    const mode = params?.jjRemoval
    if (selector !== worktreeId && mode === undefined) {
      return false
    }
    if (mode === 'forget' || mode === 'forget-and-delete' || mode === 'cleanup-only') {
      workspacePresent.workspacePresent = false
      respond(success(id, { removed: true, ok: true }))
    } else {
      respond(
        success(id, {
          removed: false,
          ok: false,
          kind: 'error',
          message: 'JJ removal requires an explicit forget or forget-and-delete outcome'
        })
      )
    }
    return true
  }
  if (method === 'jj.detect') {
    respond(
      success(id, {
        ok: true,
        version: '0.44.0',
        major: 0,
        minor: 44,
        patch: 0,
        root,
        colocated: false,
        repositoryIdentity
      })
    )
    return true
  }
  if (method === 'jj.listWorkspaces') {
    respond(
      success(id, {
        ok: true,
        workspaces: workspacePresent.workspacePresent ? [{ name: 'mobile-review', root }] : []
      })
    )
    return true
  }
  if (method === 'jj.addWorkspace') {
    respond(
      success(id, {
        ok: true,
        destination: String(params?.destination ?? root),
        ...(typeof params?.name === 'string' ? { name: params.name } : {})
      })
    )
    return true
  }
  if (method === 'jj.removeWorkspace') {
    const mode = params?.jjRemoval
    respond(
      success(
        id,
        mode === 'forget' || mode === 'forget-and-delete' || mode === 'cleanup-only'
          ? { ok: true }
          : {
              ok: false,
              kind: 'error',
              message: 'JJ removal requires an explicit forget or forget-and-delete outcome'
            }
      )
    )
    return true
  }
  return false
}
