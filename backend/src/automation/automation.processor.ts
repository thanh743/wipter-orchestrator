import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { EarnerStatus, HealthLevel, ProxyStatus } from '../common/enums';
import { DockerControlService } from '../docker/docker-control.service';
import { CreatedUnit } from '../docker/docker-control.service';
import { Earner } from '../earners/earner.entity';
import { EventsGateway } from '../events/events.gateway';
import { HealthEvent } from '../health/health-event.entity';
import { Proxy } from '../proxies/proxy.entity';

@Processor('automation', { concurrency: Number(process.env.PROVISION_CONCURRENCY || 5) })
export class AutomationProcessor extends WorkerHost implements OnApplicationShutdown {
  private readonly logger = new Logger(AutomationProcessor.name);

  constructor(
    @InjectRepository(Proxy) private readonly proxies: Repository<Proxy>,
    @InjectRepository(Earner) private readonly earners: Repository<Earner>,
    @InjectRepository(HealthEvent) private readonly events: Repository<HealthEvent>,
    private readonly docker: DockerControlService,
    private readonly gateway: EventsGateway,
  ) {
    super();
  }

  async process(job: Job) {
    if (job.name === 'PROVISION_EARNER') {
      return this.provision(job.data.proxyId);
    }
    if (job.name === 'RECONNECT_EARNER') {
      return this.reconnect(job.data.earnerId);
    }
    return null;
  }

  async onApplicationShutdown() {
    await this.worker?.close();
  }

  private async provision(proxyId: string) {
    const proxy = await this.proxies.findOneByOrFail({ id: proxyId });
    const deviceId = `wipter-${randomBytes(16).toString('hex')}`;
    let earner: Earner = await this.earners.save({
      proxyId: proxy.id,
      earnappUuid: deviceId,
      status: EarnerStatus.Pending,
    });
    let unit: CreatedUnit | undefined;

    try {
      await this.proxies.update(proxy.id, { status: ProxyStatus.Alive });
      unit = await this.docker.createEarnerUnit(proxy, deviceId);
      earner = await this.earners.save({
        ...earner,
        sidecarContainerId: unit.sidecarContainerId,
        earnerContainerId: unit.earnerContainerId,
      });
      const leakCheck = await this.docker.verifyNoLeak(proxy, unit.sidecarContainerId);
      const dnsOk = await this.docker.inspectDnsResolution(unit.sidecarContainerId);
      if (!dnsOk) {
        throw new Error('DNS resolution failed inside sidecar');
      }
      let runtime = await this.docker.inspectProviderRuntime(unit.earnerContainerId);
      for (let attempt = 0; attempt < 8 && runtime.summary === 'Waiting for Wipter connection'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        runtime = await this.docker.inspectProviderRuntime(unit.earnerContainerId);
      }
      if (runtime.invalidUuid) {
        throw new Error(runtime.summary);
      }
      if (runtime.suspended) {
        throw new Error(runtime.summary);
      }

      earner = await this.earners.save({
        ...earner,
        status: EarnerStatus.Running,
        lastSeenIp: leakCheck.egressIp,
        isConnected: runtime.connected,
        connectedAt: runtime.connected ? new Date() : undefined,
        errorMessage: runtime.connected ? null : runtime.summary,
      });
      await this.proxies.update(proxy.id, { status: ProxyStatus.Alive, lastEgressIp: leakCheck.egressIp });
      await this.events.save({
        level: HealthLevel.Info,
        title: 'Earner provisioned',
        message: `${proxy.label} created, verified, DNS OK, ${runtime.summary.toLowerCase()}.`,
        earnerId: earner.id,
        proxyId: proxy.id,
      });
      this.gateway.emitRefresh();
      return earner;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provision failed';
      this.logger.error(message);
      if (unit) {
        await this.docker.stop(unit.earnerContainerId).catch(() => undefined);
        await this.docker.stop(unit.sidecarContainerId).catch(() => undefined);
      }
      await this.earners.update(earner.id, { status: EarnerStatus.Error, errorMessage: message });
      await this.proxies.update(proxy.id, { status: ProxyStatus.Dead });
      await this.events.save({
        level: message.toLowerCase().includes('suspended') ? HealthLevel.Warning : HealthLevel.Error,
        title: message.toLowerCase().includes('suspended') ? 'Wipter suspended' : 'Provision failed',
        message,
        earnerId: earner.id,
        proxyId: proxy.id,
      });
      this.gateway.emitRefresh();
      throw error;
    }
  }

  private async reconnect(earnerId: string) {
    let earner = await this.earners.findOneOrFail({ where: { id: earnerId } });
    const proxy = earner.proxy ?? await this.proxies.findOneByOrFail({ id: earner.proxyId });
    const deviceId = earner.earnappUuid || `wipter-${randomBytes(16).toString('hex')}`;
    let unit: CreatedUnit | undefined;

    try {
      await this.earners.update(earner.id, {
        status: EarnerStatus.Pending,
        isConnected: false,
        errorMessage: 'Reconnect queued',
      });
      await this.docker.remove(earner.earnerContainerId).catch(() => undefined);
      await this.docker.remove(earner.sidecarContainerId).catch(() => undefined);

      unit = await this.docker.createEarnerUnit(proxy, deviceId);
      earner = await this.earners.save({
        ...earner,
        earnappUuid: deviceId,
        sidecarContainerId: unit.sidecarContainerId,
        earnerContainerId: unit.earnerContainerId,
      });

      const leakCheck = await this.docker.verifyNoLeak(proxy, unit.sidecarContainerId);
      const dnsOk = await this.docker.inspectDnsResolution(unit.sidecarContainerId);
      if (!dnsOk) throw new Error('DNS resolution failed inside sidecar');

      let runtime = await this.docker.inspectProviderRuntime(unit.earnerContainerId);
      for (let attempt = 0; attempt < 10 && runtime.summary === 'Waiting for Wipter connection'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        runtime = await this.docker.inspectProviderRuntime(unit.earnerContainerId);
      }
      if (runtime.invalidUuid || runtime.suspended) throw new Error(runtime.summary);

      earner = await this.earners.save({
        ...earner,
        status: EarnerStatus.Running,
        lastSeenIp: leakCheck.egressIp,
        isConnected: runtime.connected,
        connectedAt: runtime.connected ? new Date() : earner.connectedAt,
        errorMessage: runtime.connected ? null : runtime.summary,
      });
      await this.proxies.update(proxy.id, { status: ProxyStatus.Alive, lastEgressIp: leakCheck.egressIp });
      await this.events.save({
        level: runtime.connected ? HealthLevel.Info : HealthLevel.Warning,
        title: runtime.connected ? 'Wipter connected' : 'Wipter reconnect waiting',
        message: `${proxy.label}: ${runtime.summary}, egress ${leakCheck.egressIp}.`,
        earnerId: earner.id,
        proxyId: proxy.id,
      });
      this.gateway.emitRefresh();
      return earner;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reconnect failed';
      this.logger.error(message);
      if (unit) {
        await this.docker.stop(unit.earnerContainerId).catch(() => undefined);
        await this.docker.stop(unit.sidecarContainerId).catch(() => undefined);
      }
      await this.earners.update(earner.id, {
        status: EarnerStatus.Error,
        isConnected: false,
        errorMessage: message,
      });
      await this.events.save({
        level: HealthLevel.Error,
        title: 'Reconnect failed',
        message: `${proxy.label}: ${message}`,
        earnerId: earner.id,
        proxyId: proxy.id,
      });
      this.gateway.emitRefresh();
      throw error;
    }
  }
}
