import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Earner } from '../earners/earner.entity';

@Entity('earnings')
export class Earning {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  earnerId: string;

  @ManyToOne(() => Earner, (earner) => earner.earnings, { onDelete: 'CASCADE' })
  earner: Earner;

  @Column({ type: 'numeric', precision: 12, scale: 4 })
  balanceUsd: string;

  @CreateDateColumn()
  capturedAt: Date;
}
