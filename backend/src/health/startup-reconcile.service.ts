import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { EarnerStatus, HealthLevel } from '../common/enums';
import { DockerControlService } from '../docker/docker-control.service';
import { Earner } from '../earners/earner.entity';
import { EventsGateway } from '../events/events.gateway';
import { HealthEvent } from './health-event.entity';

@Injectable()
export class StartupReconcileService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupReconcileService.name);

  constructor(
    @InjectRepository(Earner) private readonly earners: Repository<Earner>,
    @InjectRepository(HealthEvent) private readonly events: Repository<HealthEvent>,
    private readonly docker: DockerControlService,
    private readonly audit: AuditService,
    private readonly gateway: EventsGateway,
  ) {}

  async onApplicationBootstrap() {
    const shouldRun = process.env.STARTUP_RECONCILE !== 'false';
    if (!shouldRun) return;
    setTimeout(() => void this.reconcile(), 5_000);
  }

  private async reconcile() {
    const earners = await this.earners.find({ relations: ['proxy'] });
    for (const earner of earners) {
      let createdUnit: { sidecarContainerId: string; earnerContainerId: string } | undefined;
      try {
        if (earner.status === EarnerStatus.Stopped || earner.status === EarnerStatus.Dead) continue;
        const sidecarRunning = await this.docker.getContainerRunning(earner.sidecarContainerId);
        const appRunning = await this.docker.getContainerRunning(earner.earnerContainerId);

        if (sidecarRunning && appRunning) continue;

        const unit = await this.docker.createEarnerUnit(earner.proxy, earner.earnappUuid);
        createdUnit = unit;
        const leakCheck = await this.docker.verifyNoLeak(earner.proxy, unit.sidecarContainerId);
        const dnsOk = await this.docker.inspectDnsResolution(unit.sidecarContainerId);
        if (!dnsOk) throw new Error('DNSCrypt verification failed');
        const runtime = await this.docker.inspectProviderRuntime(unit.earnerContainerId);
        if (runtime.suspended) {
          await this.docker.stop(unit.earnerContainerId).catch(() => undefined);
          await this.docker.stop(unit.sidecarContainerId).catch(() => undefined);
        }

        await this.earners.save({
          ...earner,
          sidecarContainerId: unit.sidecarContainerId,
          earnerContainerId: unit.earnerContainerId,
          status: runtime.invalidUuid || runtime.suspended ? EarnerStatus.Error : EarnerStatus.Running,
          lastSeenIp: leakCheck.egressIp,
          isConnected: runtime.connected,
          connectedAt: runtime.connected ? (earner.connectedAt ?? new Date()) : earner.connectedAt,
          errorMessage: runtime.invalidUuid || runtime.suspended ? runtime.summary : null,
        });

        await this.events.save({
          level: runtime.connected ? HealthLevel.Info : HealthLevel.Warning,
          title: 'Startup reconcile recreated unit',
          message: `${earner.proxy?.label || earner.id}: ${runtime.summary}.`,
          earnerId: earner.id,
          proxyId: earner.proxyId,
        });
        await this.audit.record('earner.startup_recreated', { earnerId: earner.id, proxyId: earner.proxyId });
      } catch (error) {
        if (createdUnit) {
          await this.docker.stop(createdUnit.earnerContainerId).catch(() => undefined);
          await this.docker.stop(createdUnit.sidecarContainerId).catch(() => undefined);
        }
        this.logger.warn(error instanceof Error ? error.message : 'Startup reconcile failed');
      }
    }
    this.gateway.emitRefresh();
  }
}
