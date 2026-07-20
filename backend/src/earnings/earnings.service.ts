import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Earning } from './earning.entity';

@Injectable()
export class EarningsService {
  constructor(@InjectRepository(Earning) private readonly earnings: Repository<Earning>) {}

  async findRecent() {
    return this.earnings.find({ order: { capturedAt: 'ASC' }, take: 500 });
  }

  async createSnapshot(earnerId: string, balanceUsd: number) {
    return this.earnings.save({ earnerId, balanceUsd: balanceUsd.toFixed(4) });
  }

  async total() {
    const result = await this.earnings
      .createQueryBuilder('earning')
      .select('SUM(earning.balanceUsd)', 'total')
      .getRawOne<{ total: string | null }>();
    return { total: Number(result?.total ?? 0) };
  }
}
