export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export type ProxyRecord = {
  id: string;
  type: 'http' | 'socks5';
  host: string;
  port: number;
  label: string;
  status: 'untested' | 'alive' | 'dead';
  lastEgressIp?: string;
};

export type Earner = {
  id: string;
  proxyId: string;
  proxy?: ProxyRecord;
  earnappUuid: string;
  status: 'pending' | 'running' | 'stopped' | 'error' | 'dead';
  lastSeenIp?: string;
  errorMessage?: string;
  claimUrl?: string;
  isConnected?: boolean;
  connectedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type HealthEvent = {
  id: string;
  level: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  createdAt: string;
};

export type Earning = {
  id: string;
  earnerId: string;
  balanceUsd: string;
  capturedAt: string;
};

export type ProviderAccount = {
  email: string;
  hasPassword: boolean;
  source: 'database' | 'env' | 'missing';
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean }>('/health'),
  earners: () => request<Earner[]>('/earners'),
  summary: () => request<{ total: number; running: number; pending: number; errors: number; aliveProxies: number }>('/earners/summary'),
  events: () => request<HealthEvent[]>('/health-events'),
  earnings: () => request<Earning[]>('/earnings'),
  totalEarnings: () => request<{ total: number }>('/earnings/total'),
  account: () => request<ProviderAccount>('/provider-account'),
  saveAccount: (email: string, password?: string) => request<ProviderAccount>('/provider-account', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }),
  connectAll: (email?: string, password?: string) => request<{ ok: boolean; queued: number }>('/earners/connect', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }),
  importProxies: (raw: string, labelPrefix: string, provision: boolean) => request('/proxies/import', {
    method: 'POST',
    body: JSON.stringify({ raw, labelPrefix, provision }),
  }),
  reconcileAll: () => request('/earners/reconcile', { method: 'POST' }),
  reconcile: (id: string) => request(`/earners/${id}/reconcile`, { method: 'POST' }),
  action: (id: string, action: 'start' | 'stop' | 'restart') => request(`/earners/${id}/${action}`, { method: 'POST' }),
  remove: (id: string) => request(`/earners/${id}`, { method: 'DELETE' }),
  removeAll: () => request<{ ok: boolean; removed: number }>('/earners', { method: 'DELETE' }),
  logs: (id: string) => request<{ sidecar: string; earnapp: string }>(`/earners/${id}/logs`),
};
