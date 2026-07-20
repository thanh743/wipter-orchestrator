import { Column, CreateDateColumn, Entity, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProxyStatus, ProxyType } from '../common/enums';
import { Earner } from '../earners/earner.entity';

@Entity('proxies')
export class Proxy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ProxyType })
  type: ProxyType;

  @Column()
  host: string;

  @Column({ type: 'int' })
  port: number;

  @Column({ nullable: true })
  username?: string;

  @Column({ nullable: true })
  password?: string;

  @Column()
  label: string;

  @Column({ type: 'enum', enum: ProxyStatus, default: ProxyStatus.Untested })
  status: ProxyStatus;

  @Column({ nullable: true })
  lastEgressIp?: string;

  @Column({ default: false })
  isBurned: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @OneToOne(() => Earner, (earner) => earner.proxy)
  earner?: Earner;
}
