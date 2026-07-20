import { ProxyType } from '../common/enums';

export type ParsedProxy = {
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
};

export function parseProxyLine(line: string): ParsedProxy {
  const trimmed = line.trim();
  if (!trimmed) {
    throw new Error('Empty proxy line');
  }

  const url = new URL(trimmed);
  const scheme = url.protocol.replace(':', '');
  if (scheme !== ProxyType.Http && scheme !== ProxyType.Socks5) {
    throw new Error(`Unsupported proxy type: ${scheme}`);
  }

  const port = Number(url.port);
  if (!url.hostname || !Number.isInteger(port) || port <= 0) {
    throw new Error('Proxy must include host and port');
  }

  return {
    type: scheme as ProxyType,
    host: url.hostname,
    port,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
  };
}
