import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AllowWhenReadOnly } from '../billing/subscription-access';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

/**
 * Requires a valid access token (plus any @Roles on the handler) and documents it in OpenAPI.
 * Use on a controller or a handler instead of UseGuards(JwtAuthGuard, RolesGuard).
 *
 * allowWhenReadOnly: writes still work when the subscription is inactive (billing, so a locked-out
 * tenant can pay). Otherwise writes get 402 while the tenant is read-only.
 */
export function Authenticated(options: { allowWhenReadOnly?: boolean } = {}) {
  const decorators = [
    UseGuards(JwtAuthGuard, RolesGuard),
    ApiBearerAuth(),
    ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token, or the user was deactivated' }),
  ];
  if (options.allowWhenReadOnly) {
    decorators.push(AllowWhenReadOnly());
  } else {
    decorators.push(
      ApiResponse({ status: 402, description: 'Subscription inactive (trial ended or unpaid): writes are refused, reads still work' }),
    );
  }
  return applyDecorators(...decorators);
}
