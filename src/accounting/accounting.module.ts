import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated } from '../auth/authenticated.decorator';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.guard';
import { AsOfQuery, CloseFiscalYearDto, CreateAccountDto, CreateJournalEntryDto, DateRangeQuery } from './accounting.dto';
import { AccountingService } from './accounting.service';
import { ClosingService } from './closing.service';

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

  /** Void a posted entry. Entries are never deleted; a void entry is excluded from reports. Not allowed in a closed year. */
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

@ApiTags('Year-end closing')
@Controller('fiscal-years')
@Authenticated()
export class FiscalYearsController {
  constructor(private readonly closing: ClosingService) {}

  /** Closed fiscal years, the books' lock date, and the next year to close with a preview of its result. */
  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.closing.status(user);
  }

  /**
   * Close a fiscal year: posts a closing entry dated the year end that zeroes every revenue and expense
   * account into retained earnings, and locks the year (no new or voided entries dated in it).
   * Any earlier unclosed year is swept in.
   */
  @Post('close')
  @HttpCode(200)
  @Roles('Admin')
  @ApiBadRequestResponse({ description: 'Not a fiscal year end, year not over, or no retained earnings account' })
  @ApiConflictResponse({ description: 'The year is already closed' })
  close(@CurrentUser() user: AuthUser, @Body() dto: CloseFiscalYearDto) {
    return this.closing.close(user, dto.fiscalYearEnd, dto.retainedEarningsAccountId);
  }

  /** Reopen the latest closed fiscal year for corrections; its closing entry is voided, not deleted. */
  @Post(':fiscalYearEnd/reopen')
  @HttpCode(200)
  @Roles('Admin')
  @ApiBadRequestResponse({ description: 'Not the latest closed year' })
  reopen(@CurrentUser() user: AuthUser, @Param('fiscalYearEnd') fiscalYearEnd: string) {
    return this.closing.reopen(user, fiscalYearEnd);
  }
}

@Module({
  controllers: [AccountsController, JournalEntriesController, ReportsController, FiscalYearsController],
  providers: [AccountingService, ClosingService],
})
export class AccountingModule {}
