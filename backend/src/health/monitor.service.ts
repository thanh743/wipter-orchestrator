import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AlertService } from '../alerts/alert.service';
import { EarnerStatus, HealthLevel } from '../common/enums';
import { DockerControlService } from '../docker/docker-control.service';
import { Earner } from '../earners/earner.entity';
import { EventsGateway } from '../events/events.gateway';
import { HealthEvent } from './health-event.entity';

@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);

  constructor(
    @InjectRepository(Earner) private readonly earners: Repository<Earner>,
    @InjectRepository(HealthEvent) private readonly events: Repository<HealthEvent>,
    private readonly docker: DockerControlService,
    private readonly gateway: EventsGateway,
    private readonly alerts: AlertService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async healthCheck() {
    const running = await this.earners.find({ where: { status: EarnerStatus.Running } });
    for (const earner of running) {
      try {
        const sidecarRunning = await this.docker.getContainerRunning(earner.sidecarContainerId);
        const appRunning = await this.docker.getContainerRunning(earner.earnerContainerId);
        if (!sidecarRunning || !appRunning) {
          await this.earners.update(earner.id, {
            status: EarnerStatus.Error,
            errorMessage: 'Container is not running',
          });
          await this.events.save({
            level: HealthLevel.Error,
            title: 'Container stopped',
            message: `${earner.proxy?.label || earner.id} is not fully running.`,
            earnerId: earner.id,
            proxyId: earner.proxyId,
          });
          await this.alerts.send(`Wipter Orchestrator: ${earner.proxy?.label || earner.id} container stopped.`);
          continue;
        }

        const [leakCheck, dnsOk, runtime] = await Promise.all([
          this.docker.verifyNoLeak(earner.proxy, earner.sidecarContainerId),
          this.docker.inspectDnsResolution(earner.sidecarContainerId),
          this.docker.inspectProviderRuntime(earner.earnerContainerId),
        ]);

        if (!dnsOk) {
          throw new Error('DNSCrypt verification failed');
        }

        await this.earners.update(earner.id, {
          lastSeenIp: leakCheck.egressIp,
          isConnected: runtime.connected,
          connectedAt: runtime.connected ? (earner.connectedAt ?? new Date()) : earner.connectedAt,
          errorMessage: runtime.connected ? null : runtime.summary,
          status: runtime.invalidUuid || runtime.suspended ? EarnerStatus.Error : EarnerStatus.Running,
        });

        if (runtime.suspended) {
          await this.docker.stop(earner.earnerContainerId).catch(() => undefined);
          await this.docker.stop(earner.sidecarContainerId).catch(() => undefined);
          await this.events.save({
            level: HealthLevel.Warning,
            title: 'Wipter suspended',
            message: `${earner.proxy?.label || earner.id}: ${runtime.summary}.`,
            earnerId: earner.id,
            proxyId: earner.proxyId,
          });
          await this.alerts.send(`Wipter Orchestrator: ${earner.proxy?.label || earner.id} appears suspended.`);
          continue;
        }

        if (!runtime.connected) {
          await this.events.save({
            level: HealthLevel.Warning,
            title: 'Wipter not connected',
            message: `${earner.proxy?.label || earner.id}: ${runtime.summary}.`,
            earnerId: earner.id,
            proxyId: earner.proxyId,
          });
          await this.alerts.send(`Wipter Orchestrator: ${earner.proxy?.label || earner.id} is not connected (${runtime.summary}).`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Monitor failed';
        this.logger.warn(message);
        await this.docker.stop(earner.earnerContainerId).catch(() => undefined);
        await this.docker.stop(earner.sidecarContainerId).catch(() => undefined);
        await this.earners.update(earner.id, {
          status: EarnerStatus.Error,
          errorMessage: message,
          isConnected: false,
        });
        await this.events.save({
          level: HealthLevel.Error,
          title: 'Leak check stopped earner',
          message: `${earner.proxy?.label || earner.id}: ${message}.`,
          earnerId: earner.id,
          proxyId: earner.proxyId,
        });
        await this.alerts.send(`Wipter Orchestrator: ${earner.proxy?.label || earner.id} stopped by leak check (${message}).`);
      }
    }
    this.gateway.emitRefresh();
  }
}
