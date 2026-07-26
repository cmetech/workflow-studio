export interface HostInfo {
  appVersion: string
  os: 'macos' | 'windows' | 'linux' | 'browser'
  arch: string
}

export interface NativeBridge {
  hostHealth(): Promise<HostInfo>
}
