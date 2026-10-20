import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

/** Requires a valid access token (plus any @Roles on the handler) and documents it in OpenAPI. */
export function Authenticated() {
  return applyDecorators(
    UseGuards(JwtAuthGuard, RolesGuard),
    ApiBearerAuth(),
    ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token, or the user was deactivated' }),
  );
}
