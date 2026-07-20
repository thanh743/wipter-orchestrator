import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Proxy } from './proxy.entity';
import { ProxiesController } from './proxies.controller';
import { ProxiesService } from './proxies.service';

@Module({
  imports: [TypeOrmModule.forFeature([Proxy]), BullModule.registerQueue({ name: 'automation' })],
  controllers: [ProxiesController],
  providers: [ProxiesService],
  exports: [ProxiesService],
})
export class ProxiesModule {}
