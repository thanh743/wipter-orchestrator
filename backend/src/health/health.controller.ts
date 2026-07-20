import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { EarnerStatus, ProxyStatus } from '../common/enums';
import { DockerControlService } from '../docker/docker-control.service';
import { Earner } from '../earners/earner.entity';
import { Proxy } from '../proxies/proxy.entity';
import { HealthEvent } from './health-event.entity';

@Controller()
export class HealthController {
  constructor(
    @InjectRepository(HealthEvent) private readonly events: Repository<HealthEvent>,
    @InjectRepository(Earner) private readonly earners: Repository<Earner>,
    @InjectRepository(Proxy) private readonly proxies: Repository<Proxy>,
    private readonly docker: DockerControlService,
    private readonly audit: AuditService,
  ) {}

  @Get('health')
  async health() {
    const docker = await this.docker.ping();
    return { ok: true, docker };
  }

  @Get('health-events')
  eventsList() {
    return this.events.find({ order: { createdAt: 'DESC' }, take: 50 });
  }

  @Get('audit-log')
  auditLog() {
    return this.audit.recent();
  }

  @Get('metrics')
  async metrics() {
    const [totalEarners, running, pending, errors, connected, totalProxies, aliveProxies, events] = await Promise.all([
      this.earners.count(),
      this.earners.count({ where: { status: EarnerStatus.Running } }),
      this.earners.count({ where: { status: EarnerStatus.Pending } }),
      this.earners.count({ where: { status: EarnerStatus.Error } }),
      this.earners.count({ where: { isConnected: true } }),
      this.proxies.count(),
      this.proxies.count({ where: { status: ProxyStatus.Alive } }),
      this.events.count(),
    ]);
    return {
      earners: { total: totalEarners, running, pending, errors, connected },
      proxies: { total: totalProxies, alive: aliveProxies },
      healthEvents: events,
      docker: await this.docker.ping(),
      system: await this.docker.systemInfo(),
      at: new Date().toISOString(),
    };
  }
}
