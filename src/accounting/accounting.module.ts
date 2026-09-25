import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Authenticated } from '../auth/authenticated.decorator';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.guard';
import { AsOfQuery, CreateAccountDto, CreateJournalEntryDto, DateRangeQuery } from './accounting.dto';
import { AccountingService } from './accounting.service';

@ApiTags('Chart of accounts')
@Controller('accounts')
@Authenticated()
export class AccountsController {
  constructor(private readonly accounting: AccountingService) {}

  /** List the tenant's chart of accounts, ordered by code. */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.accounting.listAccounts(user);
  }

  /** Add an account. Codes are unique per tenant (409 on a duplicate). */
  @Post()
  @Roles('Admin')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAccountDto) {
    return this.accounting.createAccount(user, dto);
  }
}

@ApiTags('Journal entries')
@Controller('journal-entries')
@Authenticated()
export class JournalEntriesController {
  constructor(private readonly accounting: AccountingService) {}

  /** List the latest 200 entries with their lines, optionally within a date range. */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() range: DateRangeQuery) {
    return this.accounting.listEntries(user, range);
  }

  /** Get one entry with its lines. */
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounting.getEntry(user, id);
  }

  /**
   * Post a journal entry. Each line has either a debit or a credit, and total debits must equal
   * total credits (checked in satang). Entries are numbered per tenant.
   */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateJournalEntryDto) {
    return this.accounting.createEntry(user, dto);
  }

  /** Void a posted entry. Entries are never deleted; a void entry is excluded from reports. */
  @Post(':id/void')
  @Roles('Admin')
  void(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounting.voidEntry(user, id);
  }
}

@ApiTags('Reports')
@Controller('reports')
@Authenticated()
export class ReportsController {
  constructor(private readonly accounting: AccountingService) {}

  /** Trial balance of posted entries up to `asOf` (all dates if omitted). */
  @Get('trial-balance')
  trialBalance(@CurrentUser() user: AuthUser, @Query() query: AsOfQuery) {
    return this.accounting.trialBalance(user, query.asOf);
  }

  /** Revenue, expenses and net income for the period `from`..`to` (either bound optional). */
  @Get('income-statement')
  incomeStatement(@CurrentUser() user: AuthUser, @Query() range: DateRangeQuery) {
    return this.accounting.incomeStatement(user, range);
  }

  /** Assets, liabilities and equity as of `asOf`; profit to date appears as current earnings in equity. */
  @Get('balance-sheet')
  balanceSheet(@CurrentUser() user: AuthUser, @Query() query: AsOfQuery) {
    return this.accounting.balanceSheet(user, query.asOf);
  }
}

@Module({
  controllers: [AccountsController, JournalEntriesController, ReportsController],
  providers: [AccountingService],
})
export class AccountingModule {}
