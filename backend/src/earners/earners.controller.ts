import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { EarnersService } from './earners.service';

type ConnectAllDto = {
  email?: string;
  password?: string;
};

@Controller('earners')
export class EarnersController {
  constructor(private readonly earnersService: EarnersService) {}

  @Get()
  findAll() {
    return this.earnersService.findAll();
  }

  @Get('summary')
  summary() {
    return this.earnersService.summary();
  }

  @Post('reconcile')
  reconcileAll() {
    return this.earnersService.reconcileAll();
  }

  @Post('connect')
  connectAll(@Body() body: ConnectAllDto) {
    return this.earnersService.connectAll(body.email, body.password);
  }

  @Delete()
  removeAll() {
    return this.earnersService.removeAll();
  }

  @Post(':id/start')
  start(@Param('id') id: string) {
    return this.earnersService.start(id);
  }

  @Post(':id/stop')
  stop(@Param('id') id: string) {
    return this.earnersService.stop(id);
  }

  @Post(':id/restart')
  restart(@Param('id') id: string) {
    return this.earnersService.restart(id);
  }

  @Post(':id/reconcile')
  reconcile(@Param('id') id: string) {
    return this.earnersService.reconcile(id);
  }

  @Get(':id/logs')
  logs(@Param('id') id: string) {
    return this.earnersService.logs(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.earnersService.remove(id);
  }
}
