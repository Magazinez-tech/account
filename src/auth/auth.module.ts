import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { LoginDto, RefreshDto } from './auth.dto';
import { AuthService } from './auth.service';
import { Authenticated } from './authenticated.decorator';
import { AuthUser, CurrentUser } from './jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Sign in to a tenant (identified by tenantId or tenantSlug). Returns an access token
   * (JWT_EXPIRATION, default 24h) and a refresh token (JWT_REFRESH_EXPIRATION, default 7d).
   */
  @Post('login')
  @HttpCode(200)
  @ApiUnauthorizedResponse({ description: 'Invalid credentials (also returned for an unknown tenant slug)' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  /** Exchange a refresh token for a new token pair. */
  @Post('refresh')
  @HttpCode(200)
  @ApiUnauthorizedResponse({ description: 'Invalid or expired refresh token, or the user was deactivated' })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  /** The signed-in user and their roles. */
  @Get('me')
  @Authenticated()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }
}

@Module({
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
