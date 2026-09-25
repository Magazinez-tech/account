import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiTags } from '@nestjs/swagger';
import { AuthModule } from '../auth/auth.module';
import { Authenticated } from '../auth/authenticated.decorator';
import { RateLimit } from '../auth/rate-limit.decorator';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.guard';
import { AcceptInvitationDto, InviteUserDto, UpdateUserDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@Controller('users')
@Authenticated()
@Roles('Admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Users of the tenant with their roles and status. */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.users.listUsers(user);
  }

  /**
   * Change a user's role and/or deactivate/reactivate them. Deactivation signs the user out on their
   * next request. The last active Admin can't be demoted or deactivated, and nobody can deactivate themselves.
   */
  @Patch(':id')
  @ApiBadRequestResponse({ description: 'Would leave no active Admin, or deactivates yourself' })
  @ApiNotFoundResponse({ description: 'User not found in this tenant' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.updateUser(user, id, dto);
  }
}

@ApiTags('Users')
@Controller('invitations')
@Authenticated()
@Roles('Admin')
export class InvitationsController {
  constructor(private readonly users: UsersService) {}

  /** Invitations not yet accepted or revoked (including expired ones, flagged). */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.users.listInvitations(user);
  }

  /**
   * Invite someone by email. The response's `token` is shown only once: share it as
   * `<APP_URL>/invite/<token>` (valid 7 days, single use). Re-inviting an email replaces its open invitation.
   * Counts against the plan's user limit.
   */
  @Post()
  @ApiConflictResponse({ description: 'A user with this email already exists' })
  invite(@CurrentUser() user: AuthUser, @Body() dto: InviteUserDto) {
    return this.users.invite(user, dto);
  }

  /** Revoke an open invitation; its link stops working. */
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Revoked' })
  @ApiNotFoundResponse({ description: 'No open invitation with this id' })
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.revokeInvitation(user, id);
  }
}

/** Public: the invitee has no account yet; the token in the link is the credential. */
@ApiTags('Invite links (public)')
@Controller('invites')
export class InviteAcceptController {
  constructor(private readonly users: UsersService) {}

  /** What an invite link is for: email, name, company and tenant slug. */
  @Get(':token')
  @RateLimit('publicLookup')
  @ApiNotFoundResponse({ description: 'Invitation is invalid or has expired' })
  preview(@Param('token') token: string) {
    return this.users.previewInvitation(token);
  }

  /** Accept an invitation by setting a password; creates the user and returns tokens. */
  @Post(':token/accept')
  @RateLimit('publicLookup')
  @ApiNotFoundResponse({ description: 'Invitation is invalid or has expired' })
  accept(@Param('token') token: string, @Body() dto: AcceptInvitationDto) {
    return this.users.acceptInvitation(token, dto);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [UsersController, InvitationsController, InviteAcceptController],
  providers: [UsersService],
})
export class UsersModule {}
