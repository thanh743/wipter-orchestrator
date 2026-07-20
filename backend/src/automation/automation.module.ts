import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DockerControlModule } from '../docker/docker-control.module';
import { Earner } from '../earners/earner.entity';
import { EventsModule } from '../events/events.module';
import { HealthEvent } from '../health/health-event.entity';
import { ProviderAccountModule } from '../provider-account/provider-account.module';
import { Proxy } from '../proxies/proxy.entity';
import { AutomationProcessor } from './automation.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'automation' }),
    TypeOrmModule.forFeature([Proxy, Earner, HealthEvent]),
    DockerControlModule,
    ProviderAccountModule,
    EventsModule,
  ],
  providers: [AutomationProcessor],
})
export class AutomationModule {}
