import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { fromSatang, toSatang } from '../common/money';
import { AccountType, JournalEntry, JournalKind, JournalLine } from '../database/entities';
import { AccountBalance } from './statements';

/**
 * Ledger operations shared by AccountingService and ClosingService. All take the EntityManager of
 * a TenantDb.run transaction, so they are tenant-scoped by RLS.
 */

/**
 * Posted debit-minus-credit per account, in satang, for entries dated within [from, to]
 * (either bound optional). Every account is returned, including those with no activity.
 * excludeClosing leaves out year-end closing entries (the income statement shows the year's
 * real revenue and expenses, not their zeroing).
 */
export async function queryAccountBalances(
  m: EntityManager,
  range: { from?: string; to?: string },
  options: { excludeClosing?: boolean } = {},
): Promise<AccountBalance[]> {
  const rows: { id: string; code: string; name: string; type: AccountType; debit: string; credit: string }[] = await m.query(
    `SELECT a.id, a.code, a.name, a.type,
            COALESCE(SUM(l.debit), 0)  AS debit,
            COALESCE(SUM(l.credit), 0) AS credit
       FROM chart_of_accounts a
       LEFT JOIN (journal_lines l
                  JOIN journal_entries e
                    ON e.id = l.journal_entry_id
                   AND e.status = 'posted'
                   AND ($1::date IS NULL OR e.entry_date >= $1::date)
                   AND ($2::date IS NULL OR e.entry_date <= $2::date)
                   AND (NOT $3 OR e.kind <> 'closing'))
         ON l.account_id = a.id
      GROUP BY a.id
      ORDER BY a.code`,
    [range.from ?? null, range.to ?? null, options.excludeClosing ?? false],
  );
  return rows.map((r) => ({
    accountId: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    net: toSatang(r.debit) - toSatang(r.credit),
  }));
}

/**
 * Takes the per-tenant ledger lock. Entry numbering and year-end closing both hold it, so a
 * closing can't interleave with a posting into the year being closed.
 */
export async function lockLedger(m: EntityManager, tenantId: string) {
  await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tenantId]);
}

/** Latest closed fiscal year end (YYYY-MM-DD), or null if no year has been closed. */
export async function closedThrough(m: EntityManager): Promise<string | null> {
  const [row]: { closed_through: string | null }[] = await m.query(
    `SELECT to_char(MAX(fiscal_year_end), 'YYYY-MM-DD') AS closed_through FROM fiscal_closings`,
  );
  return row?.closed_through ?? null;
}

/** Refuses changes dated inside a closed fiscal year. Call while holding lockLedger. */
export async function assertPeriodOpen(m: EntityManager, entryDate: string) {
  const through = await closedThrough(m);
  if (through && entryDate <= through) {
    throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: 'Period is closed', closedThrough: through });
  }
}

/** Inserts a posted entry with the next number. Lines are in satang. Call while holding lockLedger. */
export async function insertEntry(
  m: EntityManager,
  entry: {
    tenantId: string;
    createdBy: string;
    entryDate: string;
    description?: string | null;
    reference?: string | null;
    kind?: JournalKind;
    lines: { accountId: string; debit: number; credit: number; description?: string | null }[];
  },
): Promise<string> {
  const [{ next }] = await m.query('SELECT COALESCE(MAX(entry_no), 0) + 1 AS next FROM journal_entries WHERE tenant_id = $1', [
    entry.tenantId,
  ]);
  const saved = await m.getRepository(JournalEntry).save({
    tenantId: entry.tenantId,
    entryNo: Number(next),
    entryDate: entry.entryDate,
    description: entry.description ?? null,
    reference: entry.reference ?? null,
    status: 'posted',
    kind: entry.kind ?? 'manual',
    createdBy: entry.createdBy,
  });
  await m.getRepository(JournalLine).insert(
    entry.lines.map((l, i) => ({
      tenantId: entry.tenantId,
      journalEntryId: saved.id,
      accountId: l.accountId,
      description: l.description ?? null,
      debit: fromSatang(l.debit).toFixed(2),
      credit: fromSatang(l.credit).toFixed(2),
      lineNo: i + 1,
    })),
  );
  return saved.id;
}

