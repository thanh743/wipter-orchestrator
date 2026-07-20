import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Docker = require('dockerode');
import { resolve4 } from 'dns/promises';
import { decryptSecret } from '../common/credential-crypto';
import { ProxyType } from '../common/enums';
import { ProviderAccountService } from '../provider-account/provider-account.service';
import { Proxy } from '../proxies/proxy.entity';

export type CreatedUnit = {
  sidecarContainerId: string;
  earnerContainerId: string;
};

export type ProviderRuntimeStatus = {
  connected: boolean;
  invalidUuid: boolean;
  suspended: boolean;
  summary: string;
};

export type LeakCheckResult = {
  egressIp: string;
  ipv6Blocked: boolean;
};

@Injectable()
export class DockerControlService {
  private readonly logger = new Logger(DockerControlService.name);
  private readonly docker: Docker;
  private readonly dryRun: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly accounts: ProviderAccountService,
  ) {
    this.docker = new Docker({ socketPath: config.get('DOCKER_SOCKET', '/var/run/docker.sock') });
    this.dryRun = config.get('DRY_RUN_DOCKER', 'true') === 'true';
  }

  async ping() {
    if (this.dryRun) return { ok: true, dryRun: true };
    await this.docker.ping();
    return { ok: true, dryRun: false };
  }

  async systemInfo() {
    if (this.dryRun) return { dryRun: true };
    const [info, df] = await Promise.all([
      this.docker.info(),
      this.docker.df().catch(() => undefined),
    ]);
    return {
      dryRun: false,
      cpus: info.NCPU,
      memoryBytes: info.MemTotal,
      containers: info.Containers,
      containersRunning: info.ContainersRunning,
      images: info.Images,
      layersSizeBytes: df?.LayersSize,
      volumes: df?.Volumes?.length ?? 0,
    };
  }

  async pullImage(image: string) {
    if (this.dryRun) return;
    try {
      await this.docker.getImage(image).inspect();
    } catch {
      await new Promise<void>((resolve, reject) => {
        this.docker.pull(image, (error, stream) => {
          if (error || !stream) return reject(error);
          this.docker.modem.followProgress(stream, (progressError) => progressError ? reject(progressError) : resolve());
        });
      });
    }
  }

  async createEarnerUnit(proxy: Proxy, deviceId: string): Promise<CreatedUnit> {
    const safeLabel = proxy.label.replace(/[^a-zA-Z0-9_.-]/g, '-').toLowerCase();
    const sidecarName = `eo-sidecar-${safeLabel}`;
    const earnerName = `eo-wipter-${safeLabel}`;
    const providerImage = this.config.get('WIPTER_IMAGE', 'earnapp-orchestrator/wipter-official:latest');
    const sidecarImage = this.config.get('SIDECAR_IMAGE', 'earnapp-orchestrator/redsocks-sidecar:latest');
    const account = await this.accounts.resolve();

    if (this.dryRun) {
      this.logger.log(`Dry run: would create ${sidecarName} and ${earnerName}`);
      return {
        sidecarContainerId: `dry-sidecar-${proxy.id}`,
        earnerContainerId: `dry-earner-${proxy.id}`,
      };
    }

    await this.pullImage(providerImage);
    await this.removeByName(sidecarName);
    await this.removeByName(earnerName);

    const sidecar = await this.docker.createContainer({
      Image: sidecarImage,
      name: sidecarName,
      Labels: {
        'earnapp-orchestrator.kind': 'sidecar',
        'earnapp-orchestrator.proxy-id': proxy.id,
      },
      Env: await this.sidecarEnv(proxy),
      HostConfig: {
        CapAdd: ['NET_ADMIN'],
        Memory: this.mb('SIDECAR_MEMORY_MB', 128),
        NanoCpus: this.number('SIDECAR_NANO_CPUS', 100_000_000),
        PidsLimit: this.number('SIDECAR_PIDS_LIMIT', 128),
        LogConfig: this.logConfig(),
        RestartPolicy: { Name: 'unless-stopped' },
      },
    });
    await sidecar.start();
    await this.waitForSidecarReady(sidecar.id);

    const earner = await this.docker.createContainer({
      Image: providerImage,
      name: earnerName,
      Labels: {
        'earnapp-orchestrator.kind': 'earner',
        'earnapp-orchestrator.proxy-id': proxy.id,
      },
      Env: [
        `WIPTER_EMAIL=${account.email}`,
        `WIPTER_PASSWORD=${account.password}`,
        `WIPTER_DEVICE_NAME=${this.wipterDeviceName(proxy.label)}`,
        `WIPTER_DEVICE_ID=${deviceId}`,
      ],
      HostConfig: {
        NetworkMode: `container:${sidecar.id}`,
        Memory: this.mb('EARNER_MEMORY_MB', 768),
        NanoCpus: this.number('EARNER_NANO_CPUS', 500_000_000),
        PidsLimit: this.number('EARNER_PIDS_LIMIT', 256),
        LogConfig: this.logConfig(),
        RestartPolicy: { Name: 'unless-stopped' },
        ShmSize: 512 * 1024 * 1024,
      },
    });
    await earner.start();

    return { sidecarContainerId: sidecar.id, earnerContainerId: earner.id };
  }

  async start(containerId?: string) {
    if (!containerId || this.dryRun) return;
    try {
      await this.docker.getContainer(containerId).start();
    } catch (error) {
      if (!this.isContainerGoneOrAlreadyChanged(error)) throw error;
    }
  }

  async stop(containerId?: string) {
    if (!containerId || this.dryRun) return;
    try {
      await this.docker.getContainer(containerId).stop({ t: 10 });
    } catch (error) {
      if (!this.isContainerGoneOrAlreadyChanged(error)) throw error;
    }
  }

  async remove(containerId?: string) {
    if (!containerId || this.dryRun) return;
    const container = this.docker.getContainer(containerId);
    try {
      await container.remove({ force: true });
    } catch (error) {
      if (!this.isContainerGoneOrAlreadyChanged(error)) throw error;
    }
  }

  async logs(containerId?: string) {
    if (!containerId) return '';
    if (this.dryRun) return '[dry-run] Docker logs are disabled until DRY_RUN_DOCKER=false';
    const container = this.docker.getContainer(containerId);
    const buffer = await container.logs({ stdout: true, stderr: true, tail: 1500 });
    return this.cleanDockerLogBuffer(buffer);
  }

  async inspectProviderRuntime(containerId?: string): Promise<ProviderRuntimeStatus> {
    const logs = await this.logs(containerId);
    const authError = /invalid.*(email|password|credential)|login.*fail|wrong.*password|bad credentials/i.test(logs);
    const suspended = /suspended|banned|not allowed|account disabled|device disabled|account.*suspend|device.*suspend/i.test(logs);
    const appStarted = /wipter.*started|wipter app launched|electron.*ready|xvfb ready|noVNC ready/i.test(logs);
    const loggedIn = /logged in|authenticated|dashboard|online|sharing|connected|isAppConnected:\s*true|Connection established|state update.*Online/i.test(logs);
    const genericError = /\b(uncaught|unhandled|panic|fatal|app crashed|renderer process crashed|segmentation fault)\b/i.test(logs);
    const connected = loggedIn && !authError && !suspended && !genericError;
    let summary = 'Waiting for Wipter connection';
    if (appStarted) summary = 'Wipter app is open, waiting for account/session';
    if (connected) summary = 'Wipter appears connected';
    if (authError) summary = 'Wipter authentication failed';
    if (genericError) summary = 'Wipter runtime reported an error';
    if (suspended) summary = 'Wipter device/account appears suspended';
    return { connected, invalidUuid: authError, suspended, summary };
  }

  async inspectEgressIp(sidecarContainerId?: string) {
    if (!sidecarContainerId) return null;
    if (this.dryRun) return '127.0.0.1';
    const container = this.docker.getContainer(sidecarContainerId);
    const endpoints = [
      'https://api.ipify.org',
      'https://checkip.amazonaws.com',
      'https://ipv4.icanhazip.com',
      'https://ifconfig.me/ip',
    ];
    const errors: string[] = [];
    for (const endpoint of endpoints) {
      const result = await this.execOutput(container, `curl -4 --max-time 12 -fsS ${endpoint}`);
      const match = result.output.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
      if (result.exitCode === 0 && match) return match[0];
      errors.push(`${endpoint}: ${result.output.trim() || `exit ${result.exitCode}`}`);
    }
    throw new Error(`Egress IP check failed: ${errors.join(' | ')}`);
  }

  async verifyNoLeak(proxy: Proxy, sidecarContainerId?: string): Promise<LeakCheckResult> {
    const egressIp = await this.inspectEgressIp(sidecarContainerId);
    if (!egressIp) throw new Error('Cannot verify egress IP');

    if (this.isPrivateIpv4(egressIp)) {
      throw new Error(`Egress leak detected: private IP ${egressIp}`);
    }

    if (this.blockedEgressIps().includes(egressIp)) {
      throw new Error(`Egress leak detected: blocked IP ${egressIp}`);
    }

    if (this.config.get('STRICT_PROXY_EGRESS_MATCH', 'false') === 'true' && this.isIpv4(proxy.host) && egressIp !== proxy.host) {
      throw new Error(`Egress leak detected: expected ${proxy.host}, got ${egressIp}`);
    }

    const ipv6Blocked = await this.inspectIpv6Blocked(sidecarContainerId);
    if (!ipv6Blocked) {
      throw new Error('IPv6 leak detected: IPv6 egress is reachable');
    }

    return { egressIp, ipv6Blocked };
  }

  async inspectDnsResolution(sidecarContainerId?: string) {
    if (!sidecarContainerId) return false;
    if (this.dryRun) return true;
    const container = this.docker.getContainer(sidecarContainerId);
    const exec = await container.exec({
      Cmd: ['sh', '-lc', "pgrep -f dns_tcp_proxy.py >/dev/null && grep -q '^nameserver 127.0.0.1' /etc/resolv.conf && dig +time=3 +tries=1 @127.0.0.1 -p 53 wipter.com A >/dev/null"],
      AttachStdout: true,
      AttachStderr: false,
      Tty: true,
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    return await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 15_000);
      stream.on('end', async () => {
        clearTimeout(timeout);
        const result = await exec.inspect().catch(() => undefined);
        resolve(result?.ExitCode === 0);
      });
      stream.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }

  async getContainerRunning(containerId?: string) {
    if (!containerId) return false;
    if (this.dryRun) return true;
    try {
      const inspect = await this.docker.getContainer(containerId).inspect();
      return inspect.State.Running;
    } catch {
      return false;
    }
  }

  async waitForSidecarReady(sidecarContainerId: string) {
    if (this.dryRun) return;
    const container = this.docker.getContainer(sidecarContainerId);
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const ready = await this.execExitCode(container, 'test -f /tmp/sidecar.ready');
      if (ready === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error('Sidecar failed closed before becoming ready');
  }

  private async sidecarEnv(proxy: Proxy) {
    const resolvedHost = await this.resolveProxyHost(proxy.host);
    return [
      `PROXY_TYPE=${proxy.type === ProxyType.Socks5 ? 'socks5' : 'http'}`,
      `PROXY_HOST=${proxy.host}`,
      `PROXY_RESOLVED_HOST=${resolvedHost}`,
      `PROXY_PORT=${proxy.port}`,
      `PROXY_USERNAME=${proxy.username || ''}`,
      `PROXY_PASSWORD=${decryptSecret(proxy.password, this.config.get('PROXY_SECRET_KEY', '')) || ''}`,
    ];
  }

  private async resolveProxyHost(host: string) {
    if (this.isIpv4(host)) return host;
    const addresses = await resolve4(host);
    const first = addresses[0];
    if (!first) throw new Error(`Cannot resolve proxy host ${host}`);
    return first;
  }

  private number(name: string, fallback: number) {
    const value = Number(this.config.get(name, fallback));
    return Number.isFinite(value) ? value : fallback;
  }

  private async inspectIpv6Blocked(sidecarContainerId?: string) {
    if (!sidecarContainerId) return false;
    if (this.dryRun) return true;
    const container = this.docker.getContainer(sidecarContainerId);
    const exitCode = await this.execExitCode(container, 'curl -6 --max-time 8 -fsS https://api64.ipify.org >/tmp/ipv6.out 2>/dev/null');
    return exitCode !== 0;
  }

  private async execExitCode(container: Docker.Container, command: string) {
    const exec = await container.exec({
      Cmd: ['sh', '-lc', command],
      AttachStdout: false,
      AttachStderr: false,
      Tty: false,
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    return await new Promise<number>((resolve) => {
      const timeout = setTimeout(() => resolve(124), 15_000);
      stream.on('end', async () => {
        clearTimeout(timeout);
        const result = await exec.inspect().catch(() => undefined);
        resolve(result?.ExitCode ?? 1);
      });
      stream.on('error', () => {
        clearTimeout(timeout);
        resolve(1);
      });
    });
  }

  private async execOutput(container: Docker.Container, command: string) {
    const exec = await container.exec({
      Cmd: ['sh', '-lc', command],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    return await new Promise<{ exitCode: number; output: string }>((resolve) => {
      const timeout = setTimeout(() => resolve({ exitCode: 124, output: 'Command timed out' }), 25_000);
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('end', async () => {
        clearTimeout(timeout);
        const result = await exec.inspect().catch(() => undefined);
        resolve({ exitCode: result?.ExitCode ?? 1, output: this.cleanDockerLogBuffer(Buffer.concat(chunks)) });
      });
      stream.on('error', (error) => {
        clearTimeout(timeout);
        resolve({ exitCode: 1, output: error.message });
      });
    });
  }

  private isIpv4(value: string) {
    return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value);
  }

  private isPrivateIpv4(value: string) {
    const parts = value.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    return a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }

  private blockedEgressIps() {
    return String(this.config.get('LEAK_BLOCKED_IPS', ''))
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean);
  }

  private mb(name: string, fallback: number) {
    return this.number(name, fallback) * 1024 * 1024;
  }

  private logConfig() {
    return {
      Type: 'json-file',
      Config: {
        'max-size': this.config.get('DOCKER_LOG_MAX_SIZE', '10m'),
        'max-file': String(this.config.get('DOCKER_LOG_MAX_FILE', '3')),
      },
    };
  }

  private wipterDeviceName(label: string) {
    const prefix = this.config.get('WIPTER_DEVICE_PREFIX', 'wipter');
    return `${prefix}-${label}`.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 64);
  }

  private isContainerGoneOrAlreadyChanged(error: unknown) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    return statusCode === 304 || statusCode === 404;
  }

  private async removeByName(name: string) {
    try {
      const container = this.docker.getContainer(name);
      await container.remove({ force: true });
    } catch {
      // Container does not exist.
    }
  }

  private cleanDockerLogBuffer(buffer: Buffer) {
    const frames: Buffer[] = [];
    let offset = 0;
    while (offset + 8 <= buffer.length && (buffer[offset] === 1 || buffer[offset] === 2)) {
      const length = buffer.readUInt32BE(offset + 4);
      const start = offset + 8;
      const end = start + length;
      if (length < 0 || end > buffer.length) break;
      frames.push(buffer.subarray(start, end));
      offset = end;
    }
    const text = (frames.length ? Buffer.concat(frames) : buffer).toString('utf8');
    return text.replace(/[^\x09\x0a\x0d\x20-\x7eÀ-ỹ]/g, '');
  }
}
