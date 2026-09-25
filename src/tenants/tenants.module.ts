import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateTenantDto } from './tenants.dto';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Post()
  create(@Body() dto: CreateTenantDto) {
    return this.tenants.create(dto);
  }

  @Get('slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.tenants.findBySlug(slug);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
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
