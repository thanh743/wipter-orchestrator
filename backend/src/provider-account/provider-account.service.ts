import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { decryptSecret, encryptSecret } from '../common/credential-crypto';
import { ProviderAccount } from './provider-account.entity';

export type ProviderAccountStatus = {
  email: string;
  hasPassword: boolean;
  source: 'database' | 'env' | 'missing';
};

@Injectable()
export class ProviderAccountService {
  private readonly provider = 'wipter';

  constructor(
    @InjectRepository(ProviderAccount) private readonly accounts: Repository<ProviderAccount>,
    private readonly config: ConfigService,
  ) {}

  async status(): Promise<ProviderAccountStatus> {
    const saved = await this.accounts.findOneBy({ provider: this.provider });
    if (saved) {
      return { email: saved.email, hasPassword: Boolean(saved.password), source: 'database' };
    }

    const email = this.config.get<string>('WIPTER_EMAIL', '').trim();
    const password = this.config.get<string>('WIPTER_PASSWORD', '');
    if (email || password) {
      return { email, hasPassword: Boolean(password), source: 'env' };
    }

    return { email: '', hasPassword: false, source: 'missing' };
  }

  async save(email: string, password?: string) {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) throw new BadRequestException('Email is required');

    const existing = await this.accounts.findOneBy({ provider: this.provider });
    const secret = this.config.get('PROXY_SECRET_KEY', '');
    const nextPassword = password
      ? encryptSecret(password, secret)
      : existing?.password ?? null;

    if (!nextPassword) throw new BadRequestException('Password is required');

    const saved = await this.accounts.save({
      provider: this.provider,
      email: normalizedEmail,
      password: nextPassword,
    });

    return { email: saved.email, hasPassword: Boolean(saved.password), source: 'database' as const };
  }

  async resolve() {
    const saved = await this.accounts.findOneBy({ provider: this.provider });
    if (saved?.email && saved.password) {
      return {
        email: saved.email,
        password: decryptSecret(saved.password, this.config.get('PROXY_SECRET_KEY', '')) || '',
      };
    }

    const email = this.config.get<string>('WIPTER_EMAIL', '').trim();
    const password = this.config.get<string>('WIPTER_PASSWORD', '');
    if (!email || !password) {
      throw new Error('Wipter account is missing. Save email and password in the dashboard first.');
    }

    return { email, password };
  }
}
