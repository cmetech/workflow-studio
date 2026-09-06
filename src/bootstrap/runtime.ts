export function installRuntimeBootstrap(): Promise<void> {
  return Promise.resolve()
}

export function installApplicationReadiness(_readiness: {
  readonly flushRecoveryPersistence: () => Promise<void>
}): void {
  void _readiness
}
