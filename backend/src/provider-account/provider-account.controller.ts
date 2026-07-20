import { Body, Controller, Get, Post } from '@nestjs/common';
import { ProviderAccountService } from './provider-account.service';

type SaveAccountDto = {
  email: string;
  password?: string;
};

@Controller('provider-account')
export class ProviderAccountController {
  constructor(private readonly accounts: ProviderAccountService) {}

  @Get()
  status() {
    return this.accounts.status();
  }

  @Post()
  save(@Body() body: SaveAccountDto) {
    return this.accounts.save(body.email, body.password);
  }
}
