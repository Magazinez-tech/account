import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { AuthUser } from '../auth/jwt-auth.guard';
import { fromSatang } from '../common/money';
import { Account, Company, FiscalClosing, JournalEntry } from '../database/entities';
import { TenantDb } from '../database/tenant-db.service';
import { addDays, closingLines, fiscalYearContaining, isFiscalYearEnd, todayIn } from './fiscal-year';
import { closedThrough, insertEntry, lockLedger, queryAccountBalances } from './ledger';
import { section } from './statements';

/** The default chart's retained earnings account (กำไร (ขาดทุน) สะสม). */
const RETAINED_EARNINGS_CODE = '3100';

/**
 * Year-end closing: a closing entry dated the fiscal year end moves the balance of every revenue
 * and expense account into retained earnings, and locks the year against new or voided entries.
 */
@Injectable()
export class ClosingService {
  constructor(
    private readonly db: TenantDb,
    private readonly config: ConfigService,
  ) {}

  private today() {
    return todayIn(this.config.get<string>('APP_TIMEZONE', 'Asia/Bangkok'));
  }

  private async startMonth(m: EntityManager) {
    const company = await m.getRepository(Company).findOneBy({});
    return company?.fiscalYearStartMonth ?? 1;
  }

  private async retainedEarnings(m: EntityManager, accountId?: string) {
    const account = await m
      .getRepository(Account)
      .findOneBy(accountId ? { id: accountId } : { code: RETAINED_EARNINGS_CODE, type: 'equity' });
    if (!account || account.type !== 'equity' || !account.isActive) {
      throw new BadRequestException(
        accountId ? 'Retained earnings account must be an active equity account' : `Retained earnings account ${RETAINED_EARNINGS_CODE} not found`,
      );
    }
    return account;
  }

  // ---- Status -----------------------------------------------------------

  /**
   * Closed years, and the next year that can be closed with a preview of its result. The next year
   * follows the last closed one, or is the year of the earliest posted entry if none is closed.
   */
  status(user: AuthUser) {
    return this.db.run(user.tenantId, async (m) => {
      const startMonth = await this.startMonth(m);
      const through = await closedThrough(m);
      const closings: { fiscal_year_start: string; fiscal_year_end: string; net_income: string; created_at: Date; entry_no: number | null; journal_entry_id: string | null; closed_by_name: string | null }[] =
        await m.query(
          `SELECT to_char(c.fiscal_year_start, 'YYYY-MM-DD') AS fiscal_year_start,
                  to_char(c.fiscal_year_end, 'YYYY-MM-DD') AS fiscal_year_end,
                  c.net_income, c.created_at, c.journal_entry_id, e.entry_no, u.full_name AS closed_by_name
             FROM fiscal_closings c
             LEFT JOIN journal_entries e ON e.id = c.journal_entry_id
             LEFT JOIN users u ON u.id = c.closed_by
            ORDER BY c.fiscal_year_end DESC`,
        );

      let next: { start: string; end: string } | null = null;
      if (through) {
        next = fiscalYearContaining(addDays(through, 1), startMonth);
      } else {
        const [first]: { first: string | null }[] = await m.query(
          `SELECT to_char(MIN(entry_date), 'YYYY-MM-DD') AS first FROM journal_entries WHERE status = 'posted'`,
        );
        if (first?.first) next = fiscalYearContaining(first.first, startMonth);
      }

      let nextClosable = null;
      if (next) {
        const balances = await queryAccountBalances(m, { from: through ? addDays(through, 1) : undefined, to: next.end }, { excludeClosing: true });
        const revenue = section(balances, 'revenue', -1).total;
        const expenses = section(balances, 'expense', 1).total;
        const retained = await m.getRepository(Account).findOneBy({ code: RETAINED_EARNINGS_CODE, type: 'equity' });
        nextClosable = {
          fiscalYearStart: next.start,
          fiscalYearEnd: next.end,
          /** False until the year has ended (in APP_TIMEZONE). */
          canClose: next.end < this.today(),
          revenue: fromSatang(revenue),
          expenses: fromSatang(expenses),
          netIncome: fromSatang(revenue - expenses),
          retainedEarningsAccount: retained && { id: retained.id, code: retained.code, name: retained.name },
        };
      }

      return {
        fiscalYearStartMonth: startMonth,
        closedThrough: through,
        closings: closings.map((c) => ({
          fiscalYearStart: c.fiscal_year_start,
          fiscalYearEnd: c.fiscal_year_end,
          netIncome: Number(c.net_income),
          closedAt: c.created_at,
          closedBy: c.closed_by_name,
          journalEntryId: c.journal_entry_id,
          entryNo: c.entry_no,
        })),
        nextClosable,
      };
    });
  }

  // ---- Close / reopen ---------------------------------------------------

  async close(user: AuthUser, fiscalYearEnd: string, retainedEarningsAccountId?: string) {
    await this.db.run(user.tenantId, async (m) => {
      await lockLedger(m, user.tenantId);
      const startMonth = await this.startMonth(m);
      if (!isFiscalYearEnd(fiscalYearEnd, startMonth)) {
        throw new BadRequestException(`${fiscalYearEnd} is not a fiscal year end (the fiscal year starts in month ${startMonth})`);
      }
      if (fiscalYearEnd >= this.today()) throw new BadRequestException('The fiscal year has not ended yet');
      const through = await closedThrough(m);
      if (through && fiscalYearEnd <= through) throw new ConflictException(`Fiscal years through ${through} are already closed`);

      const { start } = fiscalYearContaining(fiscalYearEnd, startMonth);
      const retained = await this.retainedEarnings(m, retainedEarningsAccountId);
      // Cumulative through the year end, including earlier closings: whatever P&L balance is left
      // (this year plus any earlier year that was never closed) is what gets closed.
      const { lines, netIncome } = closingLines(await queryAccountBalances(m, { to: fiscalYearEnd }), retained.id);

      const journalEntryId = lines.length
        ? await insertEntry(m, {
            tenantId: user.tenantId,
            createdBy: user.userId,
            entryDate: fiscalYearEnd,
            kind: 'closing',
            description: `ปิดบัญชีสิ้นปี ${start} ถึง ${fiscalYearEnd}`,
            reference: `CLOSE-${fiscalYearEnd}`,
            lines,
          })
        : null;

      await m.getRepository(FiscalClosing).insert({
        tenantId: user.tenantId,
        fiscalYearStart: start,
        fiscalYearEnd,
        journalEntryId,
        netIncome: fromSatang(netIncome).toFixed(2),
        closedBy: user.userId,
      });
    });
    return this.status(user);
  }

  /** Reopens the most recently closed year: its closing entry is voided (kept for the audit trail). */
  async reopen(user: AuthUser, fiscalYearEnd: string) {
    await this.db.run(user.tenantId, async (m) => {
      await lockLedger(m, user.tenantId);
      const through = await closedThrough(m);
      if (!through) throw new BadRequestException('No fiscal year is closed');
      if (fiscalYearEnd !== through) throw new BadRequestException(`Only the latest closed fiscal year (${through}) can be reopened`);

      const closing = await m.getRepository(FiscalClosing).findOneByOrFail({ fiscalYearEnd });
      if (closing.journalEntryId) await m.getRepository(JournalEntry).update(closing.journalEntryId, { status: 'void' });
      await m.getRepository(FiscalClosing).delete(closing.id);
    });
    return this.status(user);
  }
}
