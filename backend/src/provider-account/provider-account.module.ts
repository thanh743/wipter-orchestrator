import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProviderAccountController } from './provider-account.controller';
import { ProviderAccount } from './provider-account.entity';
import { ProviderAccountService } from './provider-account.service';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([ProviderAccount])],
  controllers: [ProviderAccountController],
  providers: [ProviderAccountService],
  exports: [ProviderAccountService],
})
export class ProviderAccountModule {}
