import { Controller, Get } from '@nestjs/common';
import { EarningsService } from './earnings.service';

@Controller('earnings')
export class EarningsController {
  constructor(private readonly earningsService: EarningsService) {}

  @Get()
  findRecent() {
    return this.earningsService.findRecent();
  }

  @Get('total')
  total() {
    return this.earningsService.total();
  }
}
