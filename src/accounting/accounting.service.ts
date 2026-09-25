import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Between, EntityManager, FindOptionsWhere, In, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { AuthUser } from '../auth/jwt-auth.guard';
import { Account, JournalEntry } from '../database/entities';
import { isUniqueViolation, TenantDb } from '../database/tenant-db.service';
import { CreateAccountDto, CreateJournalEntryDto, DateRangeQuery } from './accounting.dto';
import { toBalancedLines } from './journal-rules';
import { assertPeriodOpen, insertEntry, lockLedger, queryAccountBalances } from './ledger';
import { buildBalanceSheet, buildIncomeStatement, buildTrialBalance } from './statements';

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
