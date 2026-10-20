import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Between, EntityManager, FindOptionsWhere, In, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { AuthUser } from '../auth/jwt-auth.guard';
import { Account, JournalEntry } from '../database/entities';
import { isUniqueViolation, TenantDb } from '../database/tenant-db.service';
import { CreateAccountDto, CreateJournalEntryDto, DateRangeQuery } from './accounting.dto';
import { toBalancedLines } from './journal-rules';
import { assertPeriodOpen, insertEntry, lockLedger, queryAccountBalances } from './ledger';
import { buildBalanceSheet, buildIncomeStatement, buildTrialBalance } from './statements';

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class AccountingService {
  constructor(private readonly db: TenantDb) {}

  // ---- Chart of accounts ------------------------------------------------

  listAccounts(user: AuthUser) {
    return this.db.run(user.tenantId, (m) => m.getRepository(Account).find({ order: { code: 'ASC' } }));
  }

  async createAccount(user: AuthUser, dto: CreateAccountDto) {
    try {
      return await this.db.run(user.tenantId, async (m) => {
        const repo = m.getRepository(Account);
        // FK checks bypass RLS, so a parent id from another tenant must be rejected explicitly.
        if (dto.parentId && !(await repo.existsBy({ id: dto.parentId }))) {
          throw new BadRequestException('Parent account not found');
        }
        return repo.save({ ...dto, parentId: dto.parentId ?? null, tenantId: user.tenantId });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`Account code ${dto.code} already exists`);
      throw err;
    }
  }

  // ---- Journal entries --------------------------------------------------

  async createEntry(user: AuthUser, dto: CreateJournalEntryDto) {
    const lines = toBalancedLines(dto.lines);

    const entryId = await this.db.run(user.tenantId, async (m) => {
      const accountIds = [...new Set(lines.map((l) => l.accountId))];
      const found = await m.getRepository(Account).countBy({ id: In(accountIds), isActive: true });
      if (found !== accountIds.length) throw new BadRequestException('One or more accounts not found or inactive');

      // Holding the ledger lock serializes numbering and keeps a concurrent year-end closing out.
      await lockLedger(m, user.tenantId);
      await assertPeriodOpen(m, dto.entryDate);
      return insertEntry(m, {
        tenantId: user.tenantId,
        createdBy: user.userId,
        entryDate: dto.entryDate,
        description: dto.description,
        reference: dto.reference,
        lines,
      });
    });

    return this.getEntry(user, entryId);
  }

  listEntries(user: AuthUser, range: DateRangeQuery) {
    const where: FindOptionsWhere<JournalEntry> = {};
    if (range.from && range.to) where.entryDate = Between(range.from, range.to);
    else if (range.from) where.entryDate = MoreThanOrEqual(range.from);
    else if (range.to) where.entryDate = LessThanOrEqual(range.to);

    return this.db.run(user.tenantId, (m) =>
      m.getRepository(JournalEntry).find({
        where,
        relations: { lines: true },
        order: { entryNo: 'DESC', lines: { lineNo: 'ASC' } },
        take: 200,
      }),
    );
  }

  getEntry(user: AuthUser, id: string) {
    return this.db.run(user.tenantId, (m) => this.loadEntry(m, id));
  }

  /**
   * Posted entries are never edited or deleted; voiding keeps the audit trail. Entries in a closed
   * fiscal year can't be voided, and closing entries are only reversed by reopening their year.
   */
  voidEntry(user: AuthUser, id: string) {
    return this.db.run(user.tenantId, async (m) => {
      const entry = await this.loadEntry(m, id);
      if (entry.status === 'void') throw new ConflictException('Entry is already void');
      if (entry.kind === 'closing') throw new BadRequestException('Closing entries are reversed by reopening the fiscal year');
      if (entry.kind === 'sales') throw new BadRequestException('Billing note entries are reversed by voiding the billing note');
      await lockLedger(m, user.tenantId);
      await assertPeriodOpen(m, entry.entryDate);
      await m.getRepository(JournalEntry).update(id, { status: 'void' });
      return this.loadEntry(m, id);
    });
  }

  private async loadEntry(m: EntityManager, id: string) {
    const entry = await m.getRepository(JournalEntry).findOne({
      where: { id },
      relations: { lines: true },
      order: { lines: { lineNo: 'ASC' } },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    return entry;
  }

  // ---- Reports ----------------------------------------------------------

  /** VAT summary for ภ.พ.30: output VAT from billing notes + input VAT from journal lines on 1300. */
  async vatReport(user: AuthUser, month: string) {
    const [y, mo] = month.split('-').map(Number);
    const from = `${month}-01`;
    const to = `${y}-${String(mo).padStart(2, '0')}-${new Date(y, mo, 0).getDate()}`;

    return this.db.run(user.tenantId, async (m) => {
      const outputRows: {
        doc_no: string;
        customer_name: string;
        customer_tax_id: string | null;
        doc_date: string;
        taxable_amount: string;
        vat_amount: string;
      }[] = await m.query(
        `SELECT doc_no, customer_name, customer_tax_id, doc_date,
                (subtotal - discount) AS taxable_amount, vat_amount
           FROM sales_documents
          WHERE doc_type = 'billing_note'
            AND status IN ('issued', 'paid')
            AND doc_date BETWEEN $1 AND $2
          ORDER BY doc_date, doc_no`,
        [from, to],
      );

      const inputRows: {
        entry_no: number;
        entry_date: string;
        description: string | null;
        reference: string | null;
        vat_amount: string;
      }[] = await m.query(
        `SELECT e.entry_no, e.entry_date, e.description, e.reference, l.debit AS vat_amount
           FROM journal_lines l
           JOIN journal_entries e ON e.id = l.journal_entry_id AND e.status = 'posted'
           JOIN chart_of_accounts a ON a.id = l.account_id AND a.code = '1300'
          WHERE e.entry_date BETWEEN $1 AND $2
            AND l.debit > 0
          ORDER BY e.entry_date, e.entry_no`,
        [from, to],
      );

      const outputTaxable = outputRows.reduce((s, r) => s + parseFloat(r.taxable_amount), 0);
      const outputVat = outputRows.reduce((s, r) => s + parseFloat(r.vat_amount), 0);
      const inputVat = inputRows.reduce((s, r) => s + parseFloat(r.vat_amount), 0);

      return {
        month,
        outputVat: {
          taxableAmount: round2(outputTaxable),
          vatAmount: round2(outputVat),
          transactions: outputRows.map((r) => ({
            docNo: r.doc_no,
            customerName: r.customer_name,
            customerTaxId: r.customer_tax_id,
            docDate: r.doc_date,
            taxableAmount: parseFloat(r.taxable_amount),
            vatAmount: parseFloat(r.vat_amount),
          })),
        },
        inputVat: {
          vatAmount: round2(inputVat),
          transactions: inputRows.map((r) => ({
            entryNo: r.entry_no,
            entryDate: r.entry_date,
            description: r.description,
            reference: r.reference,
            vatAmount: parseFloat(r.vat_amount),
          })),
        },
        netVat: round2(outputVat - inputVat),
      };
    });
  }

  /** KPIs for the dashboard: cash, AR, this month's net income, overdue billing note count. */
  async dashboard(user: AuthUser) {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;

    return this.db.run(user.tenantId, async (m) => {
      const cashRow: { debit: string; credit: string }[] = await m.query(
        `SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
           FROM journal_lines l
           JOIN journal_entries e ON e.id = l.journal_entry_id AND e.status = 'posted'
           JOIN chart_of_accounts a ON a.id = l.account_id AND a.code IN ('1000', '1010', '1020')`,
        [],
      );
      const cashBalance = round2(parseFloat(cashRow[0].debit) - parseFloat(cashRow[0].credit));

      const arRow: { debit: string; credit: string }[] = await m.query(
        `SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
           FROM journal_lines l
           JOIN journal_entries e ON e.id = l.journal_entry_id AND e.status = 'posted'
           JOIN chart_of_accounts a ON a.id = l.account_id AND a.code = '1100'`,
        [],
      );
      const arBalance = round2(parseFloat(arRow[0].debit) - parseFloat(arRow[0].credit));

      const isBalances = await queryAccountBalances(m, { from: monthStart, to: today }, { excludeClosing: true });
      const { netIncome } = buildIncomeStatement(isBalances, { from: monthStart, to: today });

      const [overdueRow]: { count: string }[] = await m.query(
        `SELECT COUNT(*) AS count FROM sales_documents
          WHERE doc_type = 'billing_note' AND status = 'issued' AND due_date < $1`,
        [today],
      );

      return {
        cashBalance,
        arBalance,
        thisMonthNetIncome: netIncome,
        overdueCount: Number(overdueRow.count),
      };
    });
  }

  /** Includes closing entries: after a year is closed its profit sits in retained earnings. */
  trialBalance(user: AuthUser, asOf?: string) {
    return this.db.run(user.tenantId, async (m) => buildTrialBalance(await queryAccountBalances(m, { to: asOf }), asOf));
  }

  /** Excludes closing entries, so a closed year still shows its revenue and expenses. */
  incomeStatement(user: AuthUser, range: DateRangeQuery) {
    if (range.from && range.to && range.from > range.to) throw new BadRequestException('from must be on or before to');
    return this.db.run(user.tenantId, async (m) =>
      buildIncomeStatement(await queryAccountBalances(m, range, { excludeClosing: true }), range),
    );
  }

  /** Current earnings are the not-yet-closed profit; closed years' profit is in retained earnings. */
  balanceSheet(user: AuthUser, asOf?: string) {
    return this.db.run(user.tenantId, async (m) => buildBalanceSheet(await queryAccountBalances(m, { to: asOf }), asOf));
  }
}
