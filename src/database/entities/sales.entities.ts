import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column()
  name: string;

  @Column({ name: 'tax_id', type: 'varchar', nullable: true })
  taxId: string | null;

  /** 00000 = head office; null when the customer isn't a VAT-registered business. */
  @Column({ name: 'branch_code', type: 'varchar', nullable: true })
  branchCode: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ name: 'contact_name', type: 'varchar', nullable: true })
  contactName: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  /** Credit terms: a billing note is due this many days after its date. */
  @Column({ name: 'credit_days', type: 'smallint', default: 30 })
  creditDays: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

export const SALES_DOC_TYPES = ['quotation', 'billing_note'] as const;
export type SalesDocType = (typeof SALES_DOC_TYPES)[number];

export const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'void'] as const;
export const BILLING_NOTE_STATUSES = ['draft', 'issued', 'paid', 'void'] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];
export type BillingNoteStatus = (typeof BILLING_NOTE_STATUSES)[number];

@Entity('sales_documents')
export class SalesDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'doc_type', type: 'varchar' })
  docType: SalesDocType;

  @Column({ name: 'doc_no' })
  docNo: string;

  @Column({ type: 'varchar' })
  status: QuotationStatus | BillingNoteStatus;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  // Customer details as they were when the document was last saved.
  @Column({ name: 'customer_name' })
  customerName: string;

  @Column({ name: 'customer_tax_id', type: 'varchar', nullable: true })
  customerTaxId: string | null;

  @Column({ name: 'customer_branch_code', type: 'varchar', nullable: true })
  customerBranchCode: string | null;

  @Column({ name: 'customer_address', type: 'text', nullable: true })
  customerAddress: string | null;

  @Column({ name: 'customer_contact_name', type: 'varchar', nullable: true })
  customerContactName: string | null;

  @Column({ name: 'doc_date', type: 'date' })
  docDate: string;

  /** Quotation: valid until. Billing note: payment due. */
  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'varchar', nullable: true })
  reference: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'vat_rate', type: 'numeric', precision: 5, scale: 2 })
  vatRate: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  subtotal: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  discount: string;

  @Column({ name: 'vat_amount', type: 'numeric', precision: 18, scale: 2 })
  vatAmount: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  total: string;

  /** Billing note created from a quotation: that quotation. */
  @Column({ name: 'source_document_id', type: 'uuid', nullable: true })
  sourceDocumentId: string | null;

  /** Billing note: revenue account credited when it is issued. */
  @Column({ name: 'revenue_account_id', type: 'uuid', nullable: true })
  revenueAccountId: string | null;

  /** Billing note: entry posted on issue (Dr AR / Cr revenue, output VAT). */
  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @Column({ name: 'paid_date', type: 'date', nullable: true })
  paidDate: string | null;

  @Column({ name: 'payment_account_id', type: 'uuid', nullable: true })
  paymentAccountId: string | null;

  /** Billing note: entry posted when payment is received (Dr cash/bank / Cr AR). */
  @Column({ name: 'payment_journal_entry_id', type: 'uuid', nullable: true })
  paymentJournalEntryId: string | null;

  /** The user who created the document; printed as the issuer. */
  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => SalesDocumentLine, (line) => line.document)
  lines: SalesDocumentLine[];
}

@Entity('sales_document_lines')
export class SalesDocumentLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @ManyToOne(() => SalesDocument, (doc) => doc.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: SalesDocument;

  @Column({ name: 'line_no', type: 'smallint' })
  lineNo: number;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  quantity: string;

  @Column({ type: 'varchar', nullable: true })
  unit: string | null;

  @Column({ name: 'unit_price', type: 'numeric', precision: 18, scale: 2 })
  unitPrice: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount: string;
}
