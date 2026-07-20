import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DockerControlModule } from '../docker/docker-control.module';
import { HealthEvent } from '../health/health-event.entity';
import { ProviderAccountModule } from '../provider-account/provider-account.module';
import { Proxy } from '../proxies/proxy.entity';
import { Earner } from './earner.entity';
import { EarnersController } from './earners.controller';
import { EarnersService } from './earners.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Earner, HealthEvent, Proxy]),
    BullModule.registerQueue({ name: 'automation' }),
    DockerControlModule,
    ProviderAccountModule,
  ],
  controllers: [EarnersController],
  providers: [EarnersService],
  exports: [EarnersService],
})
export class EarnersModule {}
