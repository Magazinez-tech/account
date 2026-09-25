import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager, Not } from 'typeorm';
import { assertPeriodOpen, insertEntry, lockLedger } from '../accounting/ledger';
import { AuthUser } from '../auth/jwt-auth.guard';
import { fromSatang, toSatang } from '../common/money';
import {
  Account,
  AccountType,
  Customer,
  JournalEntry,
  QuotationStatus,
  SalesDocType,
  SalesDocument,
  SalesDocumentLine,
  SystemConfig,
} from '../database/entities';
import { isUniqueViolation, TenantDb } from '../database/tenant-db.service';
import { BillingNoteDto, ReceivePaymentDto, SalesDocumentDto } from './sales.dto';
import { addDays, assertQuotationTransition, documentTotals, formatDocNo } from './sales-math';

const LABEL: Record<SalesDocType, string> = { quotation: 'Quotation', billing_note: 'Billing note' };
const AR_ACCOUNT = '1100';
const OUTPUT_VAT_ACCOUNT = '2100';
const DEFAULT_REVENUE_ACCOUNT = '4000';
const DEFAULT_CASH_ACCOUNT = '1010';

interface ListRow {
  id: string;
  doc_no: string;
  status: string;
  customer_id: string;
  customer_name: string;
  doc_date: string;
  due_date: string | null;
  reference: string | null;
  total: string;
  related_id: string | null;
  related_no: string | null;
  created_by_name: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Quotations and billing notes. Both are numbered per type and year (QT-2026-0001), copy the
 * customer's details when saved, and can only be edited while draft.
 *
 * A billing note posts to the ledger: issuing it books the receivable (Dr AR / Cr revenue and
 * output VAT, dated the note's date), and receiving payment clears it (Dr cash or bank / Cr AR).
 * Those entries are kind 'sales' and are reversed only by voiding the note.
 */
@Injectable()
export class SalesDocumentsService {
  constructor(private readonly db: TenantDb) {}

  // ---- Read ---------------------------------------------------------------

  list(user: AuthUser, docType: SalesDocType, filter: { status?: string; customerId?: string }) {
    return this.db.run(user.tenantId, async (m) => {
      // Quotation: its live billing note. Billing note: the quotation it came from.
      const related =
        docType === 'quotation'
          ? `LEFT JOIN sales_documents r ON r.source_document_id = d.id AND r.status <> 'void'`
          : `LEFT JOIN sales_documents r ON r.id = d.source_document_id`;
      const rows: ListRow[] = await m.query(
        `SELECT d.id, d.doc_no, d.status, d.customer_id, d.customer_name,
                to_char(d.doc_date, 'YYYY-MM-DD') AS doc_date, to_char(d.due_date, 'YYYY-MM-DD') AS due_date,
                d.reference, d.total, r.id AS related_id, r.doc_no AS related_no, u.full_name AS created_by_name
           FROM sales_documents d
           ${related}
           LEFT JOIN users u ON u.id = d.created_by
          WHERE d.doc_type = $1
            AND ($2::varchar IS NULL OR d.status = $2)
            AND ($3::uuid IS NULL OR d.customer_id = $3)
          ORDER BY d.doc_date DESC, d.doc_no DESC
          LIMIT 500`,
        [docType, filter.status ?? null, filter.customerId ?? null],
      );
      return rows.map((r) => ({
        id: r.id,
        docNo: r.doc_no,
        status: r.status,
        customerId: r.customer_id,
        customerName: r.customer_name,
        docDate: r.doc_date,
        dueDate: r.due_date,
        reference: r.reference,
        total: Number(r.total),
        createdByName: r.created_by_name,
        ...(docType === 'quotation'
          ? { billingNote: r.related_id ? { id: r.related_id, docNo: r.related_no } : null }
          : { quotation: r.related_id ? { id: r.related_id, docNo: r.related_no } : null }),
      }));
    });
  }

  get(user: AuthUser, docType: SalesDocType, id: string) {
    return this.db.run(user.tenantId, (m) => this.detail(m, docType, id));
  }

  // ---- Create / edit ------------------------------------------------------

  create(user: AuthUser, docType: SalesDocType, dto: SalesDocumentDto | BillingNoteDto) {
    return this.db.run(user.tenantId, async (m) => {
      const fields = await this.prepare(m, docType, dto);
      const id = await this.insert(m, user, docType, fields);
      return this.detail(m, docType, id);
    });
  }

  update(user: AuthUser, docType: SalesDocType, id: string, dto: SalesDocumentDto | BillingNoteDto) {
    return this.db.run(user.tenantId, async (m) => {
      const doc = await this.load(m, docType, id, { lock: true });
      if (doc.status !== 'draft') throw new BadRequestException(`Only draft documents can be edited`);
      const { lines, ...fields } = await this.prepare(m, docType, dto);
      await m.getRepository(SalesDocument).update(id, fields);
      await m.getRepository(SalesDocumentLine).delete({ documentId: id });
      await m.getRepository(SalesDocumentLine).insert(lines.map((l) => ({ ...l, tenantId: user.tenantId, documentId: id })));
      return this.detail(m, docType, id);
    });
  }

  // ---- Quotations ---------------------------------------------------------

  setQuotationStatus(user: AuthUser, id: string, status: QuotationStatus) {
    return this.db.run(user.tenantId, async (m) => {
      const doc = await this.load(m, 'quotation', id, { lock: true });
      assertQuotationTransition(doc.status as QuotationStatus, status);
      await m.getRepository(SalesDocument).update(id, { status });
      return this.detail(m, 'quotation', id);
    });
  }

  /** Draft billing note with the accepted quotation's customer, lines, discount and VAT. */
  async billFromQuotation(user: AuthUser, quotationId: string, docDate = today()) {
    try {
      return await this.db.run(user.tenantId, async (m) => {
        const q = await this.load(m, 'quotation', quotationId, { lock: true, lines: true });
        if (q.status !== 'accepted') throw new BadRequestException('Only accepted quotations can be billed');
        const dto: BillingNoteDto = {
          customerId: q.customerId,
          docDate,
          reference: q.reference,
          notes: q.notes,
          vat: Number(q.vatRate) > 0,
          discount: Number(q.discount),
          lines: q.lines.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity),
            unit: l.unit,
            unitPrice: Number(l.unitPrice),
          })),
        };
        // Keep the quotation's VAT rate even if the system rate changed since.
        const fields = await this.prepare(m, 'billing_note', dto, Number(q.vatRate));
        const id = await this.insert(m, user, 'billing_note', { ...fields, sourceDocumentId: q.id });
        return this.detail(m, 'billing_note', id);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Quotation already billed');
      throw err;
    }
  }

  // ---- Billing notes ------------------------------------------------------

  /** Books the receivable: Dr AR total / Cr revenue (after discount) / Cr output VAT, dated the note's date. */
  issue(user: AuthUser, id: string) {
    return this.db.run(user.tenantId, async (m) => {
      const doc = await this.load(m, 'billing_note', id, { lock: true });
      if (doc.status !== 'draft') throw new BadRequestException('Only draft billing notes can be issued');
      const total = toSatang(doc.total);
      if (total === 0) throw new BadRequestException('Billing note total must be greater than zero');
      const vat = toSatang(doc.vatAmount);

      const ar = await this.accountByCode(m, AR_ACCOUNT);
      const revenueId = doc.revenueAccountId ?? (await this.accountByCode(m, DEFAULT_REVENUE_ACCOUNT)).id;
      const lines = [
        { accountId: ar.id, debit: total, credit: 0 },
        { accountId: revenueId, debit: 0, credit: total - vat },
      ];
      if (vat > 0) lines.push({ accountId: (await this.accountByCode(m, OUTPUT_VAT_ACCOUNT)).id, debit: 0, credit: vat });

      await lockLedger(m, user.tenantId);
      await assertPeriodOpen(m, doc.docDate);
      const entryId = await insertEntry(m, {
        tenantId: user.tenantId,
        createdBy: user.userId,
        entryDate: doc.docDate,
        description: `ใบวางบิล ${doc.docNo} ${doc.customerName}`,
        reference: doc.docNo,
        kind: 'sales',
        lines,
      });
      await m.getRepository(SalesDocument).update(id, { status: 'issued', journalEntryId: entryId, revenueAccountId: revenueId });
      return this.detail(m, 'billing_note', id);
    });
  }

  /** Full payment of an issued note: Dr cash or bank / Cr AR, dated the payment date. */
  receivePayment(user: AuthUser, id: string, dto: ReceivePaymentDto) {
    return this.db.run(user.tenantId, async (m) => {
      const doc = await this.load(m, 'billing_note', id, { lock: true });
      if (doc.status !== 'issued') throw new BadRequestException('Only issued billing notes can be paid');
      if (dto.paidDate < doc.docDate) throw new BadRequestException('Payment date is before the billing note date');
      const cash = dto.accountId
        ? await this.activeAccount(m, dto.accountId, 'asset', 'Payment account must be an active asset account')
        : await this.accountByCode(m, DEFAULT_CASH_ACCOUNT);
      const ar = await this.accountByCode(m, AR_ACCOUNT);
      const total = toSatang(doc.total);

      await lockLedger(m, user.tenantId);
      await assertPeriodOpen(m, dto.paidDate);
      const entryId = await insertEntry(m, {
        tenantId: user.tenantId,
        createdBy: user.userId,
        entryDate: dto.paidDate,
        description: `รับชำระใบวางบิล ${doc.docNo} ${doc.customerName}`,
        reference: doc.docNo,
        kind: 'sales',
        lines: [
          { accountId: cash.id, debit: total, credit: 0 },
          { accountId: ar.id, debit: 0, credit: total },
        ],
      });
      await m.getRepository(SalesDocument).update(id, {
        status: 'paid',
        paidDate: dto.paidDate,
        paymentAccountId: cash.id,
        paymentJournalEntryId: entryId,
      });
      return this.detail(m, 'billing_note', id);
    });
  }

  // ---- Void ---------------------------------------------------------------

  /**
   * Quotation: any status; not while a billing note made from it is still live.
   * Billing note: draft or issued (its journal entry is voided too); a paid note stays.
   */
  void(user: AuthUser, docType: SalesDocType, id: string) {
    return this.db.run(user.tenantId, async (m) => {
      const doc = await this.load(m, docType, id, { lock: true });
      if (doc.status === 'void') throw new ConflictException(`${LABEL[docType]} is already void`);

      if (docType === 'quotation') {
        const billed = await m.getRepository(SalesDocument).existsBy({ sourceDocumentId: id, status: Not('void') });
        if (billed) throw new BadRequestException('Void the billing note made from this quotation first');
      } else {
        if (doc.status === 'paid') throw new BadRequestException('Paid billing notes cannot be voided');
        if (doc.journalEntryId) {
          await lockLedger(m, user.tenantId);
          await assertPeriodOpen(m, doc.docDate);
          await m.getRepository(JournalEntry).update(doc.journalEntryId, { status: 'void' });
        }
      }
      await m.getRepository(SalesDocument).update(id, { status: 'void' });
      return this.detail(m, docType, id);
    });
  }

  // ---- Helpers ------------------------------------------------------------

  /** Validates references and computes totals; returns the columns to store (without numbering). */
  private async prepare(m: EntityManager, docType: SalesDocType, dto: SalesDocumentDto | BillingNoteDto, vatRateOverride?: number) {
    // FK checks bypass RLS, so referenced rows must be looked up within the tenant.
    const customer = await m.getRepository(Customer).findOneBy({ id: dto.customerId });
    if (!customer) throw new BadRequestException('Customer not found');
    if (!customer.isActive) throw new BadRequestException('Customer is inactive');

    let revenueAccountId: string | null = null;
    if (docType === 'billing_note' && 'revenueAccountId' in dto && dto.revenueAccountId) {
      revenueAccountId = (await this.activeAccount(m, dto.revenueAccountId, 'revenue', 'Revenue account must be an active revenue account')).id;
    }

    const vatRate = vatRateOverride ?? (dto.vat === false ? 0 : await this.systemVatRate(m));
    const totals = documentTotals(dto.lines, dto.discount ?? 0, vatRate);
    const dueDate = dto.dueDate ?? (docType === 'billing_note' ? addDays(dto.docDate, customer.creditDays) : null);
    if (dueDate && dueDate < dto.docDate) {
      throw new BadRequestException(docType === 'quotation' ? 'Valid-until date is before the quotation date' : 'Due date is before the billing note date');
    }

    return {
      customerId: customer.id,
      customerName: customer.name,
      customerTaxId: customer.taxId,
      customerBranchCode: customer.branchCode,
      customerAddress: customer.address,
      customerContactName: customer.contactName,
      docDate: dto.docDate,
      dueDate,
      reference: dto.reference ?? null,
      notes: dto.notes ?? null,
      vatRate: vatRate.toFixed(2),
      subtotal: fromSatang(totals.subtotal).toFixed(2),
      discount: fromSatang(totals.discount).toFixed(2),
      vatAmount: fromSatang(totals.vat).toFixed(2),
      total: fromSatang(totals.total).toFixed(2),
      revenueAccountId,
      lines: dto.lines.map((l, i) => ({
        lineNo: i + 1,
        description: l.description.trim(),
        quantity: l.quantity.toFixed(2),
        unit: l.unit ?? null,
        unitPrice: l.unitPrice.toFixed(2),
        amount: fromSatang(totals.amounts[i]).toFixed(2),
      })),
    };
  }

  /** Numbers and inserts a draft; the per-type advisory lock serializes numbering. */
  private async insert(
    m: EntityManager,
    user: AuthUser,
    docType: SalesDocType,
    fields: Awaited<ReturnType<SalesDocumentsService['prepare']>> & { sourceDocumentId?: string },
  ): Promise<string> {
    const { lines, ...columns } = fields;
    await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${user.tenantId}:sales:${docType}`]);
    const prefix = formatDocNo(docType, fields.docDate, 0).slice(0, -4);
    const [{ last }] = await m.query(
      `SELECT COALESCE(MAX(substring(doc_no FROM '[0-9]+$')::int), 0) AS last
         FROM sales_documents WHERE doc_type = $1 AND doc_no LIKE $2`,
      [docType, `${prefix}%`],
    );
    const saved = await m.getRepository(SalesDocument).save({
      ...columns,
      tenantId: user.tenantId,
      docType,
      docNo: formatDocNo(docType, fields.docDate, Number(last) + 1),
      status: 'draft',
      createdBy: user.userId,
    });
    await m.getRepository(SalesDocumentLine).insert(lines.map((l) => ({ ...l, tenantId: user.tenantId, documentId: saved.id })));
    return saved.id;
  }

  private async load(m: EntityManager, docType: SalesDocType, id: string, opts: { lock?: boolean; lines?: boolean } = {}) {
    const doc = await m.getRepository(SalesDocument).findOne({
      where: { id, docType },
      ...(opts.lock && { lock: { mode: 'pessimistic_write' as const } }),
    });
    if (!doc) throw new NotFoundException(`${LABEL[docType]} not found`);
    if (opts.lines) {
      doc.lines = await m.getRepository(SalesDocumentLine).find({ where: { documentId: id }, order: { lineNo: 'ASC' } });
    }
    return doc;
  }

  /** The document as the API returns it: amounts as numbers, with lines, issuer and related documents. */
  private async detail(m: EntityManager, docType: SalesDocType, id: string) {
    const doc = await this.load(m, docType, id, { lines: true });
    const [extra]: {
      created_by_name: string | null;
      source_no: string | null;
      bill_id: string | null;
      bill_no: string | null;
      bill_status: string | null;
      entry_no: number | null;
      payment_entry_no: number | null;
      revenue_code: string | null;
      revenue_name: string | null;
      payment_code: string | null;
      payment_name: string | null;
    }[] = await m.query(
      `SELECT u.full_name AS created_by_name, src.doc_no AS source_no,
              bill.id AS bill_id, bill.doc_no AS bill_no, bill.status AS bill_status,
              je.entry_no, pje.entry_no AS payment_entry_no,
              ra.code AS revenue_code, ra.name AS revenue_name, pa.code AS payment_code, pa.name AS payment_name
         FROM sales_documents d
         LEFT JOIN users u ON u.id = d.created_by
         LEFT JOIN sales_documents src ON src.id = d.source_document_id
         LEFT JOIN LATERAL (
                SELECT id, doc_no, status FROM sales_documents b
                 WHERE b.source_document_id = d.id ORDER BY (b.status = 'void'), b.created_at DESC LIMIT 1) bill ON true
         LEFT JOIN journal_entries je ON je.id = d.journal_entry_id
         LEFT JOIN journal_entries pje ON pje.id = d.payment_journal_entry_id
         LEFT JOIN chart_of_accounts ra ON ra.id = d.revenue_account_id
         LEFT JOIN chart_of_accounts pa ON pa.id = d.payment_account_id
        WHERE d.id = $1`,
      [id],
    );
    const account = (accountId: string | null, code: string | null, name: string | null) =>
      accountId && code ? { id: accountId, code, name } : null;

    return {
      id: doc.id,
      docType: doc.docType,
      docNo: doc.docNo,
      status: doc.status,
      customerId: doc.customerId,
      customer: {
        name: doc.customerName,
        taxId: doc.customerTaxId,
        branchCode: doc.customerBranchCode,
        address: doc.customerAddress,
        contactName: doc.customerContactName,
      },
      docDate: doc.docDate,
      dueDate: doc.dueDate,
      reference: doc.reference,
      notes: doc.notes,
      vatRate: Number(doc.vatRate),
      subtotal: Number(doc.subtotal),
      discount: Number(doc.discount),
      vatAmount: Number(doc.vatAmount),
      total: Number(doc.total),
      lines: doc.lines.map((l) => ({
        lineNo: l.lineNo,
        description: l.description,
        quantity: Number(l.quantity),
        unit: l.unit,
        unitPrice: Number(l.unitPrice),
        amount: Number(l.amount),
      })),
      createdBy: doc.createdBy,
      createdByName: extra.created_by_name,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      ...(docType === 'quotation'
        ? { billingNote: extra.bill_id ? { id: extra.bill_id, docNo: extra.bill_no, status: extra.bill_status } : null }
        : {
            quotation: doc.sourceDocumentId ? { id: doc.sourceDocumentId, docNo: extra.source_no } : null,
            revenueAccount: account(doc.revenueAccountId, extra.revenue_code, extra.revenue_name),
            journalEntry: doc.journalEntryId ? { id: doc.journalEntryId, entryNo: extra.entry_no } : null,
            paidDate: doc.paidDate,
            paymentAccount: account(doc.paymentAccountId, extra.payment_code, extra.payment_name),
            paymentJournalEntry: doc.paymentJournalEntryId ? { id: doc.paymentJournalEntryId, entryNo: extra.payment_entry_no } : null,
          }),
    };
  }

  private async systemVatRate(m: EntityManager): Promise<number> {
    const row = await m.getRepository(SystemConfig).findOneBy({ key: 'vat_rate' });
    return Number(row?.value ?? 7);
  }

  private async accountByCode(m: EntityManager, code: string) {
    const account = await m.getRepository(Account).findOneBy({ code, isActive: true });
    if (!account) throw new BadRequestException(`Account ${code} not found`);
    return account;
  }

  private async activeAccount(m: EntityManager, id: string, type: AccountType, message: string) {
    const account = await m.getRepository(Account).findOneBy({ id, type, isActive: true });
    if (!account) throw new BadRequestException(message);
    return account;
  }
}
