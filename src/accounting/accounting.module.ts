import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AsOfQuery, CreateAccountDto, CreateJournalEntryDto, DateRangeQuery } from './accounting.dto';
import { AccountingService } from './accounting.service';

@Controller('accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccountsController {
  constructor(private readonly accounting: AccountingService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.accounting.listAccounts(user);
  }

  @Post()
  @Roles('Admin')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAccountDto) {
    return this.accounting.createAccount(user, dto);
  }
}

@Controller('journal-entries')
@UseGuards(JwtAuthGuard, RolesGuard)
export class JournalEntriesController {
  constructor(private readonly accounting: AccountingService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() range: DateRangeQuery) {
    return this.accounting.listEntries(user, range);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounting.getEntry(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateJournalEntryDto) {
    return this.accounting.createEntry(user, dto);
  }

  @Post(':id/void')
  @Roles('Admin')
  void(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounting.voidEntry(user, id);
  }
}

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly accounting: AccountingService) {}

  @Get('trial-balance')
  trialBalance(@CurrentUser() user: AuthUser, @Query() query: AsOfQuery) {
    return this.accounting.trialBalance(user, query.asOf);
  }

  @Get('income-statement')
  incomeStatement(@CurrentUser() user: AuthUser, @Query() range: DateRangeQuery) {
    return this.accounting.incomeStatement(user, range);
  }

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
