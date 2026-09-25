import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AcceptInvitationDto, InviteUserDto, UpdateUserDto } from './users.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.users.listUsers(user);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.updateUser(user, id, dto);
  }
}

@Controller('invitations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class InvitationsController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.users.listInvitations(user);
  }

  @Post()
  invite(@CurrentUser() user: AuthUser, @Body() dto: InviteUserDto) {
    return this.users.invite(user, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.revokeInvitation(user, id);
  }
}

/** Public: the invitee has no account yet; the token in the link is the credential. */
@Controller('invites')
export class InviteAcceptController {
  constructor(private readonly users: UsersService) {}

  @Get(':token')
  preview(@Param('token') token: string) {
    return this.users.previewInvitation(token);
  }

  @Post(':token/accept')
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
