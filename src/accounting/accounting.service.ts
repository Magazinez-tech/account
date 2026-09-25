import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Between, EntityManager, FindOptionsWhere, In, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { AuthUser } from '../auth/jwt-auth.guard';
import { fromSatang, toSatang } from '../common/money';
import { Account, AccountType, JournalEntry, JournalLine } from '../database/entities';
import { isUniqueViolation, TenantDb } from '../database/tenant-db.service';
import { CreateAccountDto, CreateJournalEntryDto, DateRangeQuery } from './accounting.dto';
import { toBalancedLines } from './journal-rules';
import { AccountBalance, buildBalanceSheet, buildIncomeStatement, buildTrialBalance } from './statements';

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

      // Serialize numbering per tenant so concurrent posts don't collide on entry_no.
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.tenantId]);
      const [{ next }] = await m.query(
        'SELECT COALESCE(MAX(entry_no), 0) + 1 AS next FROM journal_entries WHERE tenant_id = $1',
        [user.tenantId],
      );

      const entry = await m.getRepository(JournalEntry).save({
        tenantId: user.tenantId,
        entryNo: Number(next),
        entryDate: dto.entryDate,
        description: dto.description ?? null,
        reference: dto.reference ?? null,
        status: 'posted',
        createdBy: user.userId,
      });
      await m.getRepository(JournalLine).insert(
        lines.map((l) => ({
          tenantId: user.tenantId,
          journalEntryId: entry.id,
          accountId: l.accountId,
          description: l.description ?? null,
          debit: fromSatang(l.debit).toFixed(2),
          credit: fromSatang(l.credit).toFixed(2),
          lineNo: l.lineNo,
        })),
      );
      return entry.id;
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

  /** Posted entries are never edited or deleted; voiding keeps the audit trail. */
  voidEntry(user: AuthUser, id: string) {
    return this.db.run(user.tenantId, async (m) => {
      const entry = await this.loadEntry(m, id);
      if (entry.status === 'void') throw new ConflictException('Entry is already void');
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

  /**
   * Posted debit-minus-credit per account, in satang, for entries dated within [from, to]
   * (either bound optional). Every account is returned, including those with no activity.
   */
  private async accountBalances(user: AuthUser, range: { from?: string; to?: string }): Promise<AccountBalance[]> {
    const rows: { id: string; code: string; name: string; type: AccountType; debit: string; credit: string }[] =
      await this.db.run(user.tenantId, (m) =>
        m.query(
          `SELECT a.id, a.code, a.name, a.type,
                  COALESCE(SUM(l.debit), 0)  AS debit,
                  COALESCE(SUM(l.credit), 0) AS credit
             FROM chart_of_accounts a
             LEFT JOIN (journal_lines l
                        JOIN journal_entries e
                          ON e.id = l.journal_entry_id
                         AND e.status = 'posted'
                         AND ($1::date IS NULL OR e.entry_date >= $1::date)
                         AND ($2::date IS NULL OR e.entry_date <= $2::date))
               ON l.account_id = a.id
            GROUP BY a.id
            ORDER BY a.code`,
          [range.from ?? null, range.to ?? null],
        ),
      );
    return rows.map((r) => ({
      accountId: r.id,
      code: r.code,
      name: r.name,
      type: r.type,
      net: toSatang(r.debit) - toSatang(r.credit),
    }));
  }

  async trialBalance(user: AuthUser, asOf?: string) {
    return buildTrialBalance(await this.accountBalances(user, { to: asOf }), asOf);
  }

  async incomeStatement(user: AuthUser, range: DateRangeQuery) {
    if (range.from && range.to && range.from > range.to) throw new BadRequestException('from must be on or before to');
    return buildIncomeStatement(await this.accountBalances(user, range), range);
  }

  async balanceSheet(user: AuthUser, asOf?: string) {
    return buildBalanceSheet(await this.accountBalances(user, { to: asOf }), asOf);
  }
}
