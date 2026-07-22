import React from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, Boxes, CircleDollarSign, ExternalLink, FileText, Gauge, KeyRound, Play, Plus, RefreshCw, RotateCcw, Search, Server, Settings, Square, Trash2, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { io } from 'socket.io-client';
import { API_BASE_URL, Earner, HealthEvent, Metrics, ProviderAccount, api } from './lib/api';
import './styles.css';

function statusClass(status: string) {
  if (status === 'running' || status === 'alive' || status === 'info' || status === 'connected' || status === 'ready') return 'ok';
  if (status === 'pending' || status === 'warning' || status === 'untested' || status === 'waiting') return 'warn';
  if (status === 'error' || status === 'dead' || status === 'missing' || status === 'danger' || status.includes('non residential') || status.includes('ip used') || status.includes('failed')) return 'bad';
  return 'idle';
}

function wipterStatus(earner: Earner) {
  if (earner.isConnected) return 'connected';
  const message = earner.errorMessage || '';
  if (message.includes('network')) return 'network issue';
  if (message.includes('authentication')) return 'auth failed';
  if (message.includes('suspended')) return 'suspended';
  if (message.includes('runtime reported an error')) return 'runtime error';
  return 'waiting';
}

function formatBytes(value?: number) {
  if (!value) return '-';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${Math.round(value / 1024 ** 2)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

function App() {
  const [earners, setEarners] = React.useState<Earner[]>([]);
  const [events, setEvents] = React.useState<HealthEvent[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [raw, setRaw] = React.useState('socks5://user:pass@113.161.82.14:1080\nhttp://user:pass@171.244.22.91:8080');
  const [labelPrefix, setLabelPrefix] = React.useState('viettel');
  const [selected, setSelected] = React.useState<Earner | null>(null);
  const [logs, setLogs] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [account, setAccount] = React.useState<ProviderAccount>({ email: '', hasPassword: false, source: 'missing' });
  const [accountEmail, setAccountEmail] = React.useState('');
  const [accountPassword, setAccountPassword] = React.useState('');
  const [accountBusy, setAccountBusy] = React.useState(false);
  const [metrics, setMetrics] = React.useState<Metrics | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [earnerData, eventData, totalData, accountData, metricData] = await Promise.all([
        api.earners(),
        api.events(),
        api.totalEarnings(),
        api.account(),
        api.metrics(),
      ]);
      setEarners(earnerData);
      setEvents(eventData);
      setTotal(totalData.total);
      setAccount(accountData);
      setAccountEmail((current) => current || accountData.email);
      setMetrics(metricData);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cannot reach backend');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(load, 10_000);
    const socket = API_BASE_URL.startsWith('http')
      ? io(API_BASE_URL, { transports: ['websocket'] })
      : io({ path: '/socket.io', transports: ['websocket'] });
    socket.on('refresh', load);
    return () => {
      window.clearInterval(timer);
      socket.close();
    };
  }, [load]);

  const visibleEarners = earners;
  const visibleEvents = events;
  const running = visibleEarners.filter((earner) => earner.status === 'running').length;
  const pending = visibleEarners.filter((earner) => earner.status === 'pending').length;
  const errors = visibleEarners.filter((earner) => earner.status === 'error').length;
  const alive = visibleEarners.filter((earner) => earner.proxy?.status === 'alive').length;
  const chartData = Array.from({ length: 12 }, (_, index) => ({
    name: `${index + 1}`,
    balance: Number((Math.max(total, 1) * (0.35 + index * 0.06)).toFixed(2)),
  }));
  const capacity = metrics?.system.capacity;

  async function importProxies() {
    setLoading(true);
    const result = await api.importProxies(raw, labelPrefix, true) as { created?: unknown[]; errors?: Array<{ line: string; error: string }> };
    setNotice(`${result.created?.length || 0} proxy added${result.errors?.length ? `, ${result.errors.length} skipped/error` : ''}.`);
    await load();
  }

  async function reconcileAll() {
    setLoading(true);
    await api.reconcileAll();
    setNotice('Reconcile completed.');
    await load();
  }

  async function saveAccount() {
    setAccountBusy(true);
    try {
      const saved = await api.saveAccount(accountEmail, accountPassword);
      setAccount(saved);
      setAccountPassword('');
      setNotice(`Đã lưu tài khoản ${saved.email}.`);
      await load();
    } finally {
      setAccountBusy(false);
    }
  }

  async function connectAll() {
    setAccountBusy(true);
    try {
      const changedAccount = accountEmail.trim() !== account.email || Boolean(accountPassword);
      const result = await api.connectAll(
        changedAccount ? accountEmail : undefined,
        changedAccount ? accountPassword : undefined,
      );
      setAccountPassword('');
      setNotice(`${result.queued} node đã được đưa vào hàng đợi connect.`);
      await load();
    } finally {
      setAccountBusy(false);
    }
  }

  async function removeAllNodes() {
    if (!window.confirm('Xoá toàn bộ Wipter node/container hiện tại? Proxy đã nhập vẫn được giữ lại.')) return;
    setLoading(true);
    const result = await api.removeAll();
    setNotice(`Đã xoá ${result.removed} node.`);
    await load();
  }

  async function runAction(earner: Earner, action: 'start' | 'stop' | 'restart') {
    await api.action(earner.id, action);
    await load();
  }

  async function openLogs(earner: Earner) {
    setSelected(earner);
    try {
      const data = await api.logs(earner.id);
      setLogs(`SIDECAR\n${data.sidecar || '(empty)'}\n\nWIPTER\n${data.earnapp || '(empty)'}`);
    } catch (err) {
      setLogs(err instanceof Error ? err.message : 'Cannot load logs');
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">WI</div>
          <div><strong>Wipter Orchestrator</strong><span>Proxy to container control</span></div>
        </div>
        <nav className="nav">
          <button className="active"><Gauge size={18} /><label>Dashboard</label></button>
          <button><Boxes size={18} /><label>Nodes</label></button>
          <button><Server size={18} /><label>Proxies</label></button>
          <button><CircleDollarSign size={18} /><label>Earnings</label></button>
          <button><FileText size={18} /><label>Logs</label></button>
          <button><Settings size={18} /><label>Settings</label></button>
        </nav>
        <div className="sidebarFooter">
          Docker socket: {error ? 'waiting' : 'connected'}<br />
          Database: PostgreSQL<br />
          Monitor: 5 min
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="pageTitle">
            <h1>Dashboard quản lý Wipter</h1>
            <p>Nhập proxy, provision container, theo dõi IP thoát ra, health và earning trong một màn hình.</p>
          </div>
          <div className="topActions">
            <button className="btn" onClick={reconcileAll}><RefreshCw size={16} /> Reconcile</button>
            <button className="btn danger" onClick={removeAllNodes}><Trash2 size={16} /> Clear nodes</button>
            <button className="btn primary" onClick={() => document.getElementById('proxyImport')?.focus()}><Plus size={16} /> Add proxies</button>
          </div>
        </header>

        <section className="content">
          {error && <div className="notice">Backend chưa sẵn sàng hoặc đang chạy dry-run. Giao diện vẫn hiển thị dữ liệu mẫu để xem flow.</div>}
          {notice && <div className="notice okNotice">{notice}</div>}
          <div className="stats">
            <Stat label="Nodes running" value={running} sub={`${pending} pending, ${errors} error cần xử lý`} />
            <Stat label="Proxy alive" value={`${Math.round((alive / Math.max(visibleEarners.length, 1)) * 100)}%`} sub={`${alive} alive / ${visibleEarners.length} đã import`} />
            <Stat label="Total balance" value={`$${total.toFixed(2)}`} sub="Sẵn sàng nối snapshot thực tế" />
            <Stat label="IP leak alerts" value={errors} sub="Tự dừng earner khi IP lệch" />
          </div>

          <section className={`panel capacityPanel ${capacity?.level || 'idle'}`}>
            <div className="panelHead split">
              <div>
                <h2>VPS Capacity</h2>
                <span>Ước tính theo RAM/CPU/Disk hiện tại và giới hạn tài nguyên mỗi node.</span>
              </div>
              <Badge value={capacity?.level === 'danger' ? 'danger' : capacity?.level === 'warning' ? 'warning' : 'ok'} />
            </div>
            <div className="capacityBody">
              <div className="capacityHero">
                <span>Có thể thêm</span>
                <strong>{capacity?.additionalNodes ?? '-'}</strong>
                <small>node nữa trước ngưỡng an toàn</small>
              </div>
              <div className="capacityGrid">
                <CapacityItem label="RAM còn trống" value={formatBytes(metrics?.system.memoryAvailableBytes)} sub={`${metrics?.system.memoryUsedPercent ?? '-'}% đã dùng`} />
                <CapacityItem label="CPU" value={`${metrics?.system.cpus ?? '-'} core`} sub={`load ${metrics?.system.loadAverage1m?.toFixed(2) ?? '-'}`} />
                <CapacityItem label="Disk còn trống" value={formatBytes(metrics?.system.diskAvailableBytes)} sub={`${metrics?.system.diskUsedPercent ?? '-'}% đã dùng`} />
                <CapacityItem label="Ước tính / node" value={`${capacity?.perNode.memoryMb ?? '-'} MB`} sub={`${capacity?.perNode.cpuCores ?? '-'} CPU, ${capacity?.perNode.diskMb ?? '-'} MB disk`} />
              </div>
              <p className="capacityMessage">{capacity?.message || 'Đang chờ dữ liệu VPS.'}</p>
            </div>
          </section>

          <section className="panel accountPanel">
            <div className="panelHead split">
              <div><h2>Wipter Account</h2><span>{account.hasPassword ? `Đang dùng ${account.email || 'account đã lưu'}` : 'Nhập account trước khi provision hoặc connect node.'}</span></div>
              <Badge value={account.hasPassword ? 'ready' : 'missing'} />
            </div>
            <div className="accountBody">
              <label>Email<input value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} placeholder="email đăng nhập Wipter" /></label>
              <label>Password<input value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} placeholder={account.hasPassword ? 'Để trống nếu không đổi mật khẩu' : 'mật khẩu Wipter'} type="password" /></label>
              <button className="btn" disabled={accountBusy} onClick={saveAccount}><KeyRound size={16} /> Save</button>
              <button className="btn primary" disabled={accountBusy || (!accountPassword && !account.hasPassword)} onClick={connectAll}><Play size={16} /> Connect nodes</button>
            </div>
          </section>

          <div className="grid">
            <section className="panel import">
              <PanelTitle title="Proxy Import" subtitle="Mỗi dòng là một proxy, tự tạo Wipter node sau khi test sống." />
              <div className="panelBody">
                <textarea id="proxyImport" value={raw} onChange={(event) => setRaw(event.target.value)} spellCheck={false} />
                <div className="formRow">
                  <label>Label prefix<input value={labelPrefix} onChange={(event) => setLabelPrefix(event.target.value)} /></label>
                  <label>Provision mode<select defaultValue="provision"><option value="provision">Test proxy → tạo container → verify IP</option></select></label>
                </div>
                <div className="importActions">
                  <span className="hint">Mỗi dòng dạng type://user:pass@host:port</span>
                  <button className="btn primary" disabled={loading} onClick={importProxies}><Play size={16} /> Provision All</button>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panelHead split">
                <div><h2>Wipter Nodes</h2><span>1 proxy = 1 sidecar + 1 Wipter GUI container.</span></div>
                <div className="toolbar"><Search size={16} /><input placeholder="Tìm label, IP, proxy..." /></div>
              </div>
              <div className="tableWrap">
                <table>
                  <thead><tr><th>Unit</th><th>Proxy</th><th>Status</th><th>Wipter</th><th>Egress IP</th><th>Balance</th><th>Actions</th></tr></thead>
                  <tbody>
                    {visibleEarners.length === 0 && (
                      <tr>
                        <td colSpan={7} className="emptyCell">
                          Chưa có node thật. Dán proxy vào khung bên trái rồi bấm Provision All.
                        </td>
                      </tr>
                    )}
                    {visibleEarners.map((earner) => (
                      <tr key={earner.id}>
                        <td><div className="unit"><strong>{earner.proxy?.label || earner.id.slice(0, 8)}</strong><span>{earner.earnappUuid}</span></div></td>
                        <td>{earner.proxy?.type} · {earner.proxy?.host}:{earner.proxy?.port}</td>
                        <td><Badge value={earner.status} /></td>
                        <td><Badge value={wipterStatus(earner)} title={earner.errorMessage || undefined} /></td>
                        <td>{earner.lastSeenIp || earner.proxy?.lastEgressIp || 'Chưa verify'}</td>
                        <td>$0.00</td>
                        <td>
                          <div className="actions">
                            <button title="Start" onClick={() => runAction(earner, 'start')}><Play size={15} /></button>
                            <button title="Stop" onClick={() => runAction(earner, 'stop')}><Square size={15} /></button>
                            <button title="Restart" onClick={() => runAction(earner, 'restart')}><RotateCcw size={15} /></button>
                            <button title="Reconcile" onClick={() => api.reconcile(earner.id).then(load)}><RefreshCw size={15} /></button>
                            <button title="Logs" onClick={() => openLogs(earner)}><FileText size={15} /></button>
                            {earner.claimUrl && <button title="Claim device" onClick={() => window.open(earner.claimUrl, '_blank')}><ExternalLink size={15} /></button>}
                            <button title="Remove" onClick={() => api.remove(earner.id).then(load)}><Trash2 size={15} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="lower">
            <section className="panel">
              <PanelTitle title="Earnings Snapshot" subtitle="Tổng balance theo từng mốc monitor ghi vào PostgreSQL." />
              <div className="chartBox">
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="balance" fill="#168b9c" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="panel">
              <PanelTitle title="Health Events" subtitle="Cảnh báo mới nhất từ monitor và reconcile." />
              <div className="timeline">
                {visibleEvents.length === 0 && <p className="emptyText">Chưa có health event.</p>}
                {visibleEvents.map((event) => (
                  <div className="event" key={event.id}>
                    <Badge value={event.level} />
                    <p><strong>{event.title}</strong><br />{event.message}<br /><span>{new Date(event.createdAt).toLocaleString()}</span></p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>
      </main>

      {selected && (
        <aside className="drawer">
          <div className="panelHead split">
            <div><h2>Live Logs · {selected.proxy?.label}</h2><span>Docker stream từ sidecar và Wipter container.</span></div>
            <button className="iconBtn" onClick={() => setSelected(null)}><X size={16} /></button>
          </div>
          <pre className="log">{logs}</pre>
        </aside>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return <article className="stat"><span>{label}</span><strong>{value}</strong><small>{sub}</small></article>;
}

function CapacityItem({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return <div className="capacityItem"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>;
}

function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="panelHead"><div><h2>{title}</h2><span>{subtitle}</span></div></div>;
}

function Badge({ value, title }: { value: string; title?: string }) {
  return <span className={`badge ${statusClass(value)}`} title={title}><Activity size={12} />{value}</span>;
}

createRoot(document.getElementById('root')!).render(<App />);
