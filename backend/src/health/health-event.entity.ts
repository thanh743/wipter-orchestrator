import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { HealthLevel } from '../common/enums';

@Entity('health_events')
export class HealthEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: HealthLevel })
  level: HealthLevel;

  @Column()
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ nullable: true })
  earnerId?: string;

  @Column({ nullable: true })
  proxyId?: string;

  @CreateDateColumn()
  createdAt: Date;
}
