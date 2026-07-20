import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { EarnerStatus, HealthLevel, ProxyStatus } from '../common/enums';
import { sanitizeEarner } from '../common/sanitize-response';
import { DockerControlService } from '../docker/docker-control.service';
import { HealthEvent } from '../health/health-event.entity';
import { ProviderAccountService } from '../provider-account/provider-account.service';
import { Proxy } from '../proxies/proxy.entity';
import { Earner } from './earner.entity';

@Injectable()
export class EarnersService {
  constructor(
    @InjectRepository(Earner) private readonly earners: Repository<Earner>,
    @InjectRepository(HealthEvent) private readonly events: Repository<HealthEvent>,
    @InjectRepository(Proxy) private readonly proxies: Repository<Proxy>,
    @InjectQueue('automation') private readonly automationQueue: Queue,
    private readonly docker: DockerControlService,
    private readonly audit: AuditService,
    private readonly accounts: ProviderAccountService,
  ) {}

  async findAll() {
    const earners = await this.rawFindAll();
    return earners.map(sanitizeEarner);
  }

  async findOne(id: string) {
    const earner = await this.earners.findOne({ where: { id } });
    if (!earner) throw new NotFoundException('Earner not found');
    return earner;
  }

  async start(id: string) {
    const earner = await this.findOne(id);
    await this.docker.start(earner.sidecarContainerId);
    await this.docker.start(earner.earnerContainerId);
    await this.audit.record('earner.start', { earnerId: earner.id, proxyId: earner.proxyId });
    return sanitizeEarner(await this.earners.save({ ...earner, status: EarnerStatus.Running, errorMessage: null }));
  }

  async stop(id: string) {
    const earner = await this.findOne(id);
    await this.docker.stop(earner.earnerContainerId);
    await this.docker.stop(earner.sidecarContainerId);
    await this.audit.record('earner.stop', { earnerId: earner.id, proxyId: earner.proxyId });
    return sanitizeEarner(await this.earners.save({ ...earner, status: EarnerStatus.Stopped }));
  }

  async restart(id: string) {
    await this.stop(id);
    return this.start(id);
  }

  async remove(id: string) {
    const earner = await this.findOne(id);
    await this.docker.remove(earner.earnerContainerId);
    await this.docker.remove(earner.sidecarContainerId);
    await this.earners.remove(earner);
    await this.audit.record('earner.remove', { earnerId: earner.id, proxyId: earner.proxyId });
    return { ok: true };
  }

  async removeAll() {
    const earners = await this.rawFindAll();
    for (const earner of earners) {
      await this.docker.remove(earner.earnerContainerId).catch(() => undefined);
      await this.docker.remove(earner.sidecarContainerId).catch(() => undefined);
      await this.audit.record('earner.remove', { earnerId: earner.id, proxyId: earner.proxyId });
    }
    if (earners.length) {
      await this.earners.remove(earners);
    }
    return { ok: true, removed: earners.length };
  }

  async connectAll(email?: string, password?: string) {
    if (email || password) {
      await this.accounts.save(email || '', password);
    } else {
      await this.accounts.resolve();
    }

    const earners = await this.rawFindAll();
    for (const earner of earners) {
      await this.earners.update(earner.id, {
        status: EarnerStatus.Pending,
        isConnected: false,
        errorMessage: 'Reconnect queued',
      });
      await this.automationQueue.add('RECONNECT_EARNER', { earnerId: earner.id }, {
        attempts: 2,
        backoff: { type: 'exponential', delay: 20_000 },
        removeOnComplete: 250,
        removeOnFail: 500,
      });
    }
    await this.audit.record('earner.connect_all', { metadata: { count: earners.length } });
    return { ok: true, queued: earners.length };
  }

  async logs(id: string) {
    const earner = await this.findOne(id);
    const sidecar = await this.docker.logs(earner.sidecarContainerId);
    const provider = await this.docker.logs(earner.earnerContainerId);
    return { sidecar, earnapp: provider };
  }

  async reconcile(id: string) {
    const earner = await this.findOne(id);
    const sidecarRunning = await this.docker.getContainerRunning(earner.sidecarContainerId);
    const appRunning = await this.docker.getContainerRunning(earner.earnerContainerId);
    const runtime = await this.docker.inspectProviderRuntime(earner.earnerContainerId);
    let lastSeenIp = earner.lastSeenIp;

    if (sidecarRunning) {
      try {
        const leakCheck = await this.docker.verifyNoLeak(earner.proxy, earner.sidecarContainerId);
        lastSeenIp = leakCheck.egressIp;
        const dnsOk = await this.docker.inspectDnsResolution(earner.sidecarContainerId);
        if (!dnsOk) throw new Error('DNSCrypt verification failed');
      } catch (error) {
        await this.docker.stop(earner.earnerContainerId).catch(() => undefined);
        await this.docker.stop(earner.sidecarContainerId).catch(() => undefined);
        await this.recordEvent(HealthLevel.Error, 'Leak check failed', error instanceof Error ? error.message : 'Cannot inspect egress IP', earner);
        await this.audit.record('earner.leak_stopped', { earnerId: earner.id, proxyId: earner.proxyId });
        const saved = await this.earners.save({
          ...earner,
          status: EarnerStatus.Error,
          errorMessage: error instanceof Error ? error.message : 'Leak check failed',
          isConnected: false,
        });
        return sanitizeEarner(saved);
      }
    }

    const status = sidecarRunning && appRunning
      ? EarnerStatus.Running
      : EarnerStatus.Error;

    const saved = await this.earners.save({
      ...earner,
      status,
      lastSeenIp,
      isConnected: runtime.connected,
      connectedAt: runtime.connected ? (earner.connectedAt ?? new Date()) : earner.connectedAt,
      errorMessage: status === EarnerStatus.Error
        ? 'Container is not running'
        : runtime.connected
          ? null
          : runtime.summary,
    });

    if (lastSeenIp && earner.proxy) {
      await this.proxies.update(earner.proxyId, { lastEgressIp: lastSeenIp });
    }

    await this.recordEvent(
      runtime.connected ? HealthLevel.Info : HealthLevel.Warning,
      'Reconcile completed',
      `${earner.proxy?.label || earner.id}: ${runtime.summary}, egress ${lastSeenIp || 'unknown'}.`,
      saved,
    );
    await this.audit.record('earner.reconcile', { earnerId: earner.id, proxyId: earner.proxyId, metadata: { status, connected: runtime.connected, lastSeenIp } });

    return sanitizeEarner(saved);
  }

  async reconcileAll() {
    const earners = await this.rawFindAll();
    const results: Earner[] = [];
    for (const earner of earners) {
      results.push(await this.reconcile(earner.id));
    }
    return { count: results.length, results };
  }

  async summary() {
    const [total, running, pending, errors] = await Promise.all([
      this.earners.count(),
      this.earners.count({ where: { status: EarnerStatus.Running } }),
      this.earners.count({ where: { status: EarnerStatus.Pending } }),
      this.earners.count({ where: { status: EarnerStatus.Error } }),
    ]);
    const aliveProxies = await this.earners.count({
      where: { proxy: { status: ProxyStatus.Alive } },
    });
    return { total, running, pending, errors, aliveProxies };
  }

  async recordEvent(level: HealthLevel, title: string, message: string, earner?: Earner) {
    return this.events.save({
      level,
      title,
      message,
      earnerId: earner?.id,
      proxyId: earner?.proxyId,
    });
  }

  private rawFindAll() {
    return this.earners.find({ order: { createdAt: 'DESC' } });
  }
}
