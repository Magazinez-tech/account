import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiTags } from '@nestjs/swagger';
import { AuthModule } from '../auth/auth.module';
import { Authenticated } from '../auth/authenticated.decorator';
import { RateLimit } from '../auth/rate-limit.decorator';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { CreateTenantDto } from './tenants.dto';
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

@Module({
  imports: [AuthModule],
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
