import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationModule } from './automation/automation.module';
import { AlertsModule } from './alerts/alerts.module';
import { AuditLog } from './audit/audit-log.entity';
import { AuditModule } from './audit/audit.module';
import { BasicAuthGuard } from './common/basic-auth.guard';
import { DockerControlModule } from './docker/docker-control.module';
import { Earning } from './earnings/earning.entity';
import { EarningsModule } from './earnings/earnings.module';
import { Earner } from './earners/earner.entity';
import { EarnersModule } from './earners/earners.module';
import { EventsModule } from './events/events.module';
import { HealthController } from './health/health.controller';
import { HealthEvent } from './health/health-event.entity';
import { MonitorService } from './health/monitor.service';
import { StartupReconcileService } from './health/startup-reconcile.service';
import { ProviderAccount } from './provider-account/provider-account.entity';
import { ProviderAccountModule } from './provider-account/provider-account.module';
import { ProxiesModule } from './proxies/proxies.module';
import { Proxy } from './proxies/proxy.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env', '.env'] }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('POSTGRES_HOST', 'localhost'),
        port: config.get<number>('POSTGRES_PORT', 5432),
        username: config.get('POSTGRES_USER', 'earnapp'),
        password: config.get('POSTGRES_PASSWORD', 'earnapp_dev_password'),
        database: config.get('POSTGRES_DB', 'earnapp_orchestrator'),
        entities: [Proxy, Earner, Earning, HealthEvent, AuditLog, ProviderAccount],
        synchronize: true,
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    TypeOrmModule.forFeature([HealthEvent, Earner, Proxy, Earning]),
    DockerControlModule,
    AlertsModule,
    AuditModule,
    EventsModule,
    ProviderAccountModule,
    ProxiesModule,
    EarnersModule,
    EarningsModule,
    AutomationModule,
  ],
  controllers: [HealthController],
  providers: [
    MonitorService,
    StartupReconcileService,
    { provide: APP_GUARD, useClass: BasicAuthGuard },
  ],
})
export class AppModule {}
