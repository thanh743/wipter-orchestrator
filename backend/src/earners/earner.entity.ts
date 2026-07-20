import { Column, CreateDateColumn, Entity, JoinColumn, OneToMany, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { EarnerStatus } from '../common/enums';
import { Earning } from '../earnings/earning.entity';
import { Proxy } from '../proxies/proxy.entity';

@Entity('earners')
export class Earner {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  proxyId: string;

  @OneToOne(() => Proxy, (proxy) => proxy.earner, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'proxyId' })
  proxy: Proxy;

  @Column()
  earnappUuid: string;

  @Column({ nullable: true })
  sidecarContainerId?: string;

  @Column({ nullable: true })
  earnerContainerId?: string;

  @Column({ type: 'enum', enum: EarnerStatus, default: EarnerStatus.Pending })
  status: EarnerStatus;

  @Column({ nullable: true })
  lastSeenIp?: string;

  @Column({ nullable: true, type: 'text' })
  errorMessage?: string | null;

  @Column({ nullable: true })
  claimUrl?: string;

  @Column({ default: false })
  isConnected: boolean;

  @Column({ nullable: true })
  connectedAt?: Date;

  @OneToMany(() => Earning, (earning) => earning.earner)
  earnings: Earning[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
