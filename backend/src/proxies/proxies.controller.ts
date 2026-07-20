import { Body, Controller, Get, Post } from '@nestjs/common';
import { ImportProxiesDto } from './dto/import-proxies.dto';
import { ProxiesService } from './proxies.service';

@Controller('proxies')
export class ProxiesController {
  constructor(private readonly proxiesService: ProxiesService) {}

  @Get()
  findAll() {
    return this.proxiesService.findAll();
  }

  @Post('import')
  importMany(@Body() dto: ImportProxiesDto) {
    return this.proxiesService.importMany(dto);
  }
}
