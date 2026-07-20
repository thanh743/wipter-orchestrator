import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>) {}

  record(action: string, data: Partial<AuditLog>) {
    return this.auditLogs.save({ action, actor: data.actor || 'dashboard', ...data });
  }

  recent() {
    return this.auditLogs.find({ order: { createdAt: 'DESC' }, take: 100 });
  }
}
