import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type JournalStatus = 'draft' | 'posted' | 'void';

@Entity('chart_of_accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column()
  code: string;

  @Column()
  name: string;

  @Column({ type: 'varchar' })
  type: AccountType;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('journal_entries')
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'entry_no', type: 'integer' })
  entryNo: number;

  @Column({ name: 'entry_date', type: 'date' })
  entryDate: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', nullable: true })
  reference: string | null;

  @Column({ type: 'varchar', default: 'posted' })
  status: JournalStatus;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => JournalLine, (line) => line.entry)
  lines: JournalLine[];
}

@Entity('journal_lines')
export class JournalLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'journal_entry_id', type: 'uuid' })
  journalEntryId: string;

  @ManyToOne(() => JournalEntry, (entry) => entry.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'journal_entry_id' })
  entry: JournalEntry;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // numeric columns come back from pg as strings to avoid float rounding.
  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  debit: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  credit: string;

  @Column({ name: 'line_no', type: 'smallint' })
  lineNo: number;
}
