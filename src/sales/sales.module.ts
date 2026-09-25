import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiNotFoundResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated } from '../auth/authenticated.decorator';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.guard';
import { CustomersService } from './customers.service';
import { SalesDocumentsService } from './sales-documents.service';
import {
  BillFromQuotationDto,
  BillingNoteDto,
  BillingNoteListQuery,
  CreateCustomerDto,
  CustomerListQuery,
  QuotationListQuery,
  QuotationStatusDto,
  ReceivePaymentDto,
  SalesDocumentDto,
  UpdateCustomerDto,
} from './sales.dto';

@ApiTags('Customers')
@Controller('customers')
@Authenticated()
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  /** Customers ordered by name; active only unless `includeInactive=true`. */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: CustomerListQuery) {
    return this.customers.list(user, query.includeInactive === 'true');
  }

  /** One customer. */
  @Get(':id')
  @ApiNotFoundResponse({ description: 'Customer not found' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(user, id);
  }

  /** Add a customer. Documents copy its details when they are saved. */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.customers.create(user, dto);
  }

  /** Change a customer's details, or deactivate it with `isActive: false`. Existing documents keep their copy. */
  @Patch(':id')
  @ApiNotFoundResponse({ description: 'Customer not found' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(user, id, dto);
  }
}

@ApiTags('Quotations')
@Controller('quotations')
@Authenticated()
export class QuotationsController {
  constructor(private readonly docs: SalesDocumentsService) {}

  /** Latest 500 quotations, newest first, optionally by status or customer. Includes the billing note made from each. */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: QuotationListQuery) {
    return this.docs.list(user, 'quotation', query);
  }

  /** One quotation with its lines, the issuing user and any billing note made from it. */
  @Get(':id')
  @ApiNotFoundResponse({ description: 'Quotation not found' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.get(user, 'quotation', id);
  }

  /**
   * Create a draft quotation numbered QT-<year>-<seq>. Prices exclude VAT; the discount comes off
   * before VAT. The signed-in user is recorded as the issuer.
   */
  @Post()
  @ApiBadRequestResponse({ description: 'Customer not found or inactive, discount over the subtotal, or dates out of order' })
  create(@CurrentUser() user: AuthUser, @Body() dto: SalesDocumentDto) {
    return this.docs.create(user, 'quotation', dto);
  }

  /** Replace a draft quotation's customer, dates, lines and totals. */
  @Put(':id')
  @ApiBadRequestResponse({ description: 'Not a draft' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SalesDocumentDto) {
    return this.docs.update(user, 'quotation', id, dto);
  }

  /** Move a quotation through draft -> sent -> accepted or rejected (sent -> draft to revise). */
  @Post(':id/status')
  @HttpCode(200)
  @ApiBadRequestResponse({ description: 'Transition not allowed from the current status' })
  setStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: QuotationStatusDto) {
    return this.docs.setQuotationStatus(user, id, dto.status);
  }

  /** Create a draft billing note from an accepted quotation (once; a voided billing note frees it again). */
  @Post(':id/billing-note')
  @ApiBadRequestResponse({ description: 'Quotation not accepted' })
  @ApiConflictResponse({ description: 'Quotation already billed' })
  bill(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BillFromQuotationDto) {
    return this.docs.billFromQuotation(user, id, dto.docDate);
  }

  /** Cancel a quotation. Not while a billing note made from it is still live. */
  @Post(':id/void')
  @HttpCode(200)
  @Roles('Admin')
  @ApiConflictResponse({ description: 'Already void' })
  void(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.void(user, 'quotation', id);
  }
}

@ApiTags('Billing notes')
@Controller('billing-notes')
@Authenticated()
export class BillingNotesController {
  constructor(private readonly docs: SalesDocumentsService) {}

  /** Latest 500 billing notes, newest first, optionally by status or customer. */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: BillingNoteListQuery) {
    return this.docs.list(user, 'billing_note', query);
  }

  /** One billing note with its lines, issuer, source quotation and journal entries. */
  @Get(':id')
  @ApiNotFoundResponse({ description: 'Billing note not found' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.get(user, 'billing_note', id);
  }

  /** Create a draft billing note numbered BN-<year>-<seq>. The due date defaults to the date plus the customer's credit days. */
  @Post()
  @ApiBadRequestResponse({ description: 'Customer not found or inactive, bad revenue account, or dates out of order' })
  create(@CurrentUser() user: AuthUser, @Body() dto: BillingNoteDto) {
    return this.docs.create(user, 'billing_note', dto);
  }

  /** Replace a draft billing note's customer, dates, lines and totals. */
  @Put(':id')
  @ApiBadRequestResponse({ description: 'Not a draft' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BillingNoteDto) {
    return this.docs.update(user, 'billing_note', id, dto);
  }

  /**
   * Issue a draft: posts Dr 1100 AR (total) / Cr revenue (after discount) / Cr 2100 output VAT,
   * dated the billing note's date. Refused in a closed fiscal year.
   */
  @Post(':id/issue')
  @HttpCode(200)
  @ApiBadRequestResponse({ description: 'Not a draft, zero total, or the period is closed' })
  issue(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.issue(user, id);
  }

  /** Record full payment of an issued note: posts Dr cash or bank (default 1010) / Cr 1100 AR on the payment date. */
  @Post(':id/payment')
  @HttpCode(200)
  @ApiBadRequestResponse({ description: 'Not issued, payment before the note date, bad account, or the period is closed' })
  receivePayment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceivePaymentDto) {
    return this.docs.receivePayment(user, id, dto);
  }

  /** Cancel a draft or issued billing note; an issued note's journal entry is voided. Paid notes can't be voided. */
  @Post(':id/void')
  @HttpCode(200)
  @Roles('Admin')
  @ApiBadRequestResponse({ description: 'Paid, or the period is closed' })
  @ApiConflictResponse({ description: 'Already void' })
  void(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.void(user, 'billing_note', id);
  }
}

@Module({
  controllers: [CustomersController, QuotationsController, BillingNotesController],
  providers: [CustomersService, SalesDocumentsService],
})
export class SalesModule {}
