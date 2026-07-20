type WithProxyPassword = {
  password?: string;
  hasPassword?: boolean;
};

export function sanitizeProxy<T extends WithProxyPassword | undefined | null>(proxy: T): T {
  if (!proxy) return proxy;
  const hasPassword = Boolean(proxy.password);
  const clone = { ...proxy, hasPassword };
  delete clone.password;
  return clone as T;
}

export function sanitizeEarner<T extends { proxy?: WithProxyPassword | null }>(earner: T): T {
  return {
    ...earner,
    proxy: sanitizeProxy(earner.proxy),
  };
}
