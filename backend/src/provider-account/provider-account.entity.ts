import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('provider_accounts')
export class ProviderAccount {
  @PrimaryColumn()
  provider: string;

  @Column()
  email: string;

  @Column({ type: 'text', nullable: true })
  password?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
