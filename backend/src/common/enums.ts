export enum ProxyType {
  Http = 'http',
  Socks5 = 'socks5',
}

export enum ProxyStatus {
  Untested = 'untested',
  Alive = 'alive',
  Dead = 'dead',
}

export enum EarnerStatus {
  Pending = 'pending',
  Running = 'running',
  Stopped = 'stopped',
  Error = 'error',
  Dead = 'dead',
}

export enum HealthLevel {
  Info = 'info',
  Warning = 'warning',
  Error = 'error',
}
