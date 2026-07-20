import { Module } from '@nestjs/common';
import { ProviderAccountModule } from '../provider-account/provider-account.module';
import { DockerControlService } from './docker-control.service';

@Module({
  imports: [ProviderAccountModule],
  providers: [DockerControlService],
  exports: [DockerControlService],
})
export class DockerControlModule {}
