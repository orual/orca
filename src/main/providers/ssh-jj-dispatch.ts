import type { SshJjProvider } from './ssh-jj-provider'

const sshProviders = new Map<string, SshJjProvider>()
const sshProviderGenerations = new Map<string, number>()

export const SSH_JJ_PROVIDER_UNAVAILABLE_MESSAGE =
  'Remote connection dropped. Click Reconnect on the SSH target before retrying.'

export function registerSshJjProvider(connectionId: string, provider: SshJjProvider): void {
  sshProviders.set(connectionId, provider)
  sshProviderGenerations.set(connectionId, (sshProviderGenerations.get(connectionId) ?? 0) + 1)
}

export function unregisterSshJjProvider(connectionId: string): void {
  if (sshProviders.delete(connectionId)) {
    sshProviderGenerations.set(connectionId, (sshProviderGenerations.get(connectionId) ?? 0) + 1)
  }
}

export function getSshJjProviderGeneration(connectionId: string): number {
  return sshProviderGenerations.get(connectionId) ?? 0
}

export function getSshJjProvider(connectionId: string): SshJjProvider | undefined {
  return sshProviders.get(connectionId)
}

export function requireSshJjProvider(connectionId: string): SshJjProvider {
  const provider = getSshJjProvider(connectionId)
  if (!provider) {
    throw new Error(SSH_JJ_PROVIDER_UNAVAILABLE_MESSAGE)
  }
  return provider
}
