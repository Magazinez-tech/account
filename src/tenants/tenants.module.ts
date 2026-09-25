import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiTags } from '@nestjs/swagger';
import { AuthModule } from '../auth/auth.module';
import { Authenticated } from '../auth/authenticated.decorator';
import { RateLimit } from '../auth/rate-limit.decorator';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.guard';
import { CreateTenantDto, UpdateCompanyDto } from './tenants.dto';
import { TenantsService } from './tenants.service';

@ApiTags('Tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /**
   * Sign up: creates the tenant, its company, Admin/User roles, the admin user, a trial subscription
   * and a starter chart of accounts. Returns tokens for the new admin.
   */
  @Post()
  @RateLimit('signup')
  @ApiConflictResponse({ description: 'Slug is already taken' })
  create(@Body() dto: CreateTenantDto) {
    return this.tenants.create(dto);
  }

  /** Resolve a tenant by its slug (public; used before sign-in). */
  @Get('slug/:slug')
  @RateLimit('publicLookup')
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  findBySlug(@Param('slug') slug: string) {
    return this.tenants.findBySlug(slug);
  }

  /** The caller's own tenant with its company and latest subscription. */
  @Get(':id')
  @Authenticated()
  @ApiForbiddenResponse({ description: 'The id is not the caller\'s tenant' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.tenants.findOne(id, user);
  }
}

@ApiTags('Company profile')
@Controller('company')
@Authenticated()
export class CompanyController {
  constructor(private readonly tenants: TenantsService) {}

  /** The company profile: legal name, tax ID, branch, address and contacts, printed on sales documents. */
  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.tenants.getCompany(user);
  }

  /** Update the company profile. Documents show the current profile when viewed or printed. */
  @Patch()
  @Roles('Admin')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateCompanyDto) {
    return this.tenants.updateCompany(user, dto);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [TenantsController, CompanyController],
  providers: [TenantsService],
})
export class TenantsModule {}
