import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Like, Repository } from 'typeorm';
import { ProxyStatus } from '../common/enums';
import { encryptSecret } from '../common/credential-crypto';
import { sanitizeProxy } from '../common/sanitize-response';
import { AuditService } from '../audit/audit.service';
import { ImportProxiesDto } from './dto/import-proxies.dto';
import { parseProxyLine } from './proxy-parser';
import { Proxy } from './proxy.entity';

@Injectable()
export class ProxiesService {
  constructor(
    @InjectRepository(Proxy) private readonly proxies: Repository<Proxy>,
    @InjectQueue('automation') private readonly automationQueue: Queue,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async findAll() {
    const proxies = await this.proxies.find({ order: { createdAt: 'DESC' } });
    return proxies.map(sanitizeProxy);
  }

  async importMany(dto: ImportProxiesDto) {
    const lines = dto.raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const created: Proxy[] = [];
    const errors: Array<{ line: string; error: string }> = [];
    const prefix = dto.labelPrefix || 'proxy';
    let nextIndex = await this.nextLabelIndex(prefix);

    for (const line of lines) {
      try {
        const parsed = parseProxyLine(line);
        const existing = await this.proxies.findOne({
          where: {
            type: parsed.type,
            host: parsed.host,
            port: parsed.port,
            username: parsed.username,
          },
        });
        if (existing) {
          errors.push({ line, error: `Proxy already exists as ${existing.label}` });
          continue;
        }

        const label = `${prefix}-${String(nextIndex++).padStart(3, '0')}`;
        const proxy = await this.proxies.save({
          ...parsed,
          password: encryptSecret(parsed.password, this.config.get('PROXY_SECRET_KEY', '')),
          label,
          status: ProxyStatus.Untested,
        });
        await this.audit.record('proxy.imported', { proxyId: proxy.id, metadata: { label, host: parsed.host, port: parsed.port } });
        created.push(sanitizeProxy(proxy));

        if (dto.provision !== false) {
          await this.automationQueue.add('PROVISION_EARNER', { proxyId: proxy.id }, {
            attempts: Number(this.config.get('PROVISION_ATTEMPTS', 3)),
            backoff: { type: 'exponential', delay: Number(this.config.get('PROVISION_BACKOFF_MS', 30_000)) },
            removeOnComplete: 250,
            removeOnFail: 500,
          });
        }
      } catch (error) {
        errors.push({ line, error: error instanceof Error ? error.message : 'Unknown parse error' });
      }
    }

    return { created, errors };
  }

  async markStatus(id: string, status: ProxyStatus, lastEgressIp?: string) {
    await this.proxies.update(id, { status, lastEgressIp });
    return sanitizeProxy(await this.proxies.findOneByOrFail({ id }));
  }

  private async nextLabelIndex(prefix: string) {
    const existing = await this.proxies.find({ where: { label: Like(`${prefix}-%`) }, select: { label: true } });
    const indexes = existing
      .map((proxy) => Number(proxy.label.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`))?.[1] ?? 0))
      .filter((value) => Number.isFinite(value));
    return Math.max(0, ...indexes) + 1;
  }
}
