import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { EntityManager, IsNull, MoreThan } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { AuthUser } from '../auth/jwt-auth.guard';
import { RoleName } from '../auth/roles.guard';
import { Company, Role, Tenant, User, UserInvitation, UserRole } from '../database/entities';
import { isUniqueViolation, TenantDb } from '../database/tenant-db.service';
import { AcceptInvitationDto, InviteUserDto, UpdateUserDto } from './users.dto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class UsersService {
  constructor(
    private readonly db: TenantDb,
    private readonly auth: AuthService,
  ) {}

  // ---- Users --------------------------------------------------------------

  listUsers(auth: AuthUser) {
    return this.db.run(auth.tenantId, (m) => this.queryUsers(m));
  }

  async updateUser(auth: AuthUser, id: string, dto: UpdateUserDto) {
    if (dto.isActive === false && id === auth.userId) throw new BadRequestException('You cannot deactivate yourself');

    return this.db.run(auth.tenantId, async (m) => {
      const target = await m.getRepository(User).findOneBy({ id });
      if (!target) throw new NotFoundException('User not found');
      if (dto.isActive === true && !target.isActive) await this.assertSeatAvailable(m, false);

      if (dto.role) {
        const role = await this.roleByName(m, dto.role);
        await m.getRepository(UserRole).delete({ userId: id });
        await m.getRepository(UserRole).insert({ userId: id, roleId: role.id, tenantId: auth.tenantId });
      }
      if (dto.isActive !== undefined) await m.getRepository(User).update(id, { isActive: dto.isActive });

      // Checked after the change, inside the transaction, so a throw rolls it back.
      const [{ admins }] = await m.query(
        `SELECT count(*)::int AS admins FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id AND r.name = 'Admin'
          WHERE u.is_active`,
      );
      if (admins === 0) throw new BadRequestException('At least one active Admin is required');

      const [updated] = await this.queryUsers(m, id);
      return updated;
    });
  }

  private async queryUsers(m: EntityManager, id?: string) {
    const rows: { id: string; email: string; full_name: string; is_active: boolean; last_login_at: Date | null; created_at: Date; roles: string[] }[] =
      await m.query(
        `SELECT u.id, u.email, u.full_name, u.is_active, u.last_login_at, u.created_at,
                COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
           FROM users u
           LEFT JOIN user_roles ur ON ur.user_id = u.id
           LEFT JOIN roles r ON r.id = ur.role_id
          WHERE ($1::uuid IS NULL OR u.id = $1)
          GROUP BY u.id
          ORDER BY u.created_at`,
        [id ?? null],
      );
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      isActive: r.is_active,
      lastLoginAt: r.last_login_at,
      createdAt: r.created_at,
      roles: r.roles,
    }));
  }

  /**
   * Plan seat limit: active users, plus open invitations when inviting (an accepted invite takes a
   * seat). Plans with max_users NULL are unlimited.
   */
  private async assertSeatAvailable(m: EntityManager, countInvitations: boolean) {
    const [plan]: { max_users: number | null }[] = await m.query(
      `SELECT p.max_users FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
        ORDER BY s.created_at DESC LIMIT 1`,
    );
    if (!plan || plan.max_users === null) return;
    const [{ used }] = await m.query(
      `SELECT (SELECT count(*) FROM users WHERE is_active)
            + CASE WHEN $1 THEN (SELECT count(*) FROM user_invitations
                                  WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())
                   ELSE 0 END AS used`,
      [countInvitations],
    );
    if (Number(used) >= plan.max_users) throw new ForbiddenException('Plan user limit reached');
  }

  private async roleByName(m: EntityManager, name: RoleName) {
    const role = await m.getRepository(Role).findOneBy({ name });
    if (!role) throw new BadRequestException(`Role ${name} not found`);
    return role;
  }

  // ---- Invitations (admin) -----------------------------------------------

  listInvitations(auth: AuthUser) {
    return this.db.run(auth.tenantId, async (m) => {
      const rows: { id: string; email: string; full_name: string; role: string; expires_at: Date; created_at: Date }[] = await m.query(
        `SELECT i.id, i.email, i.full_name, r.name AS role, i.expires_at, i.created_at
           FROM user_invitations i JOIN roles r ON r.id = i.role_id
          WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL
          ORDER BY i.created_at DESC`,
      );
      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        fullName: r.full_name,
        role: r.role,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        expired: r.expires_at.getTime() < Date.now(),
      }));
    });
  }

  /** Returns the raw token once; only its hash is stored. Re-inviting an email replaces the open invitation. */
  async invite(auth: AuthUser, dto: InviteUserDto) {
    const email = dto.email.toLowerCase();
    const token = randomBytes(32).toString('base64url');

    try {
      return await this.db.run(auth.tenantId, async (m) => {
        if (await m.getRepository(User).existsBy({ email })) {
          throw new ConflictException('A user with this email already exists');
        }
        const role = await this.roleByName(m, dto.role);
        await m.getRepository(UserInvitation).update({ email, acceptedAt: IsNull(), revokedAt: IsNull() }, { revokedAt: new Date() });
        await this.assertSeatAvailable(m, true);

        const invitation = await m.getRepository(UserInvitation).save({
          tenantId: auth.tenantId,
          email,
          fullName: dto.fullName,
          roleId: role.id,
          tokenHash: hashToken(token),
          invitedBy: auth.userId,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        });
        return { id: invitation.id, email, fullName: dto.fullName, role: role.name, expiresAt: invitation.expiresAt, token };
      });
    } catch (err) {
      // Two admins inviting the same email at once: the loser hits the partial unique index.
      if (isUniqueViolation(err)) throw new ConflictException('An invitation for this email is already pending');
      throw err;
    }
  }

  revokeInvitation(auth: AuthUser, id: string) {
    return this.db.run(auth.tenantId, async (m) => {
      const res = await m.getRepository(UserInvitation).update({ id, acceptedAt: IsNull(), revokedAt: IsNull() }, { revokedAt: new Date() });
      if (!res.affected) throw new NotFoundException('Invitation not found');
    });
  }

  // ---- Invitations (public, by token) ------------------------------------

  /**
   * Before sign-in the tenant is unknown, so the token lookup bypasses RLS (like the slug lookup).
   * Everything after it runs scoped to the invitation's tenant.
   */
  private async openInvitation(token: string) {
    const found = await this.db.system.getRepository(UserInvitation).findOneBy({
      tokenHash: hashToken(token),
      acceptedAt: IsNull(),
      revokedAt: IsNull(),
      expiresAt: MoreThan(new Date()),
    });
    if (!found) throw new NotFoundException('Invitation is invalid or has expired');
    return found;
  }

  async previewInvitation(token: string) {
    const inv = await this.openInvitation(token);
    return this.db.run(inv.tenantId, async (m) => {
      const tenant = await m.getRepository(Tenant).findOneByOrFail({ id: inv.tenantId });
      const company = await m.getRepository(Company).findOneBy({ tenantId: inv.tenantId });
      return { email: inv.email, fullName: inv.fullName, companyName: company?.name ?? tenant.name, tenantSlug: tenant.slug };
    });
  }

  async acceptInvitation(token: string, dto: AcceptInvitationDto) {
    const inv = await this.openInvitation(token);
    const passwordHash = await bcrypt.hash(dto.password, 10);

    let user: User;
    let tenantSlug: string;
    try {
      ({ user, tenantSlug } = await this.db.run(inv.tenantId, async (m) => {
        // Claim the invitation first; a concurrent accept or revoke leaves nothing to claim.
        const claimed = await m
          .getRepository(UserInvitation)
          .update({ id: inv.id, acceptedAt: IsNull(), revokedAt: IsNull() }, { acceptedAt: new Date() });
        if (!claimed.affected) throw new NotFoundException('Invitation is invalid or has expired');

        const created = await m.getRepository(User).save({
          tenantId: inv.tenantId,
          email: inv.email,
          fullName: inv.fullName,
          passwordHash,
        });
        await m.getRepository(UserRole).insert({ userId: created.id, roleId: inv.roleId, tenantId: inv.tenantId });
        const tenant = await m.getRepository(Tenant).findOneByOrFail({ id: inv.tenantId });
        return { user: created, tenantSlug: tenant.slug };
      }));
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A user with this email already exists');
      throw err;
    }

    return { tenantSlug, ...(await this.auth.issueTokens(user)) };
  }
}
