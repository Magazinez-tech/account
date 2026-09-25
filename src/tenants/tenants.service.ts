import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { DEFAULT_CHART } from '../accounting/default-chart';
import { AuthService } from '../auth/auth.service';
import { AuthUser } from '../auth/jwt-auth.guard';
import {
  Account,
  Company,
  Role,
  Subscription,
  SubscriptionPlan,
  SystemConfig,
  Tenant,
  User,
  UserRole,
} from '../database/entities';
import { isUniqueViolation, TenantDb } from '../database/tenant-db.service';
import { CreateTenantDto } from './tenants.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TenantsService {
  constructor(
    private readonly db: TenantDb,
    private readonly auth: AuthService,
  ) {}

  /** Signup: creates the tenant, its company, roles, admin user, trial subscription and chart of accounts. */
  async create(dto: CreateTenantDto) {
    if (await this.db.system.getRepository(Tenant).existsBy({ slug: dto.slug })) {
      throw new ConflictException('Slug is already taken');
    }

    const tenantId = randomUUID();
    const passwordHash = await bcrypt.hash(dto.adminPassword, 10);

    let admin: User;
    try {
      admin = await this.db.run(tenantId, async (m) => {
        const config = async <T>(key: string, fallback: T) =>
          ((await m.getRepository(SystemConfig).findOneBy({ key }))?.value as T) ?? fallback;

        await m.getRepository(Tenant).insert({
          id: tenantId,
          name: dto.name,
          slug: dto.slug,
          subscriptionStatus: 'trialing',
        });
        await m.getRepository(Company).insert({
          tenantId,
          name: dto.companyName,
          taxId: dto.companyTaxId ?? null,
          currency: await config('default_currency', 'THB'),
        });

        const [adminRole] = await m.getRepository(Role).save([
          { tenantId, name: 'Admin', description: 'Full access to the tenant', isSystem: true },
          { tenantId, name: 'User', description: 'Day-to-day bookkeeping', isSystem: true },
        ]);
        const user = await m.getRepository(User).save({
          tenantId,
          email: dto.adminEmail.toLowerCase(),
          fullName: dto.adminFullName,
          passwordHash,
        });
        await m.getRepository(UserRole).insert({ userId: user.id, roleId: adminRole.id, tenantId });

        const plan = await m
          .getRepository(SubscriptionPlan)
          .findOneByOrFail({ code: await config('default_plan', 'starter') });
        const trialDays = await config('trial_days', 14);
        await m.getRepository(Subscription).insert({
          tenantId,
          planId: plan.id,
          status: 'trialing',
          trialEndsAt: new Date(Date.now() + trialDays * DAY_MS),
        });

        await m.getRepository(Account).insert(DEFAULT_CHART.map((a) => ({ ...a, tenantId })));
        return user;
      });
    } catch (err) {
      // Two signups racing for the same slug: the loser hits the unique index.
      if (isUniqueViolation(err)) throw new ConflictException('Slug is already taken');
      throw err;
    }

    const tokens = await this.auth.issueTokens(admin);
    return { tenantId, adminId: admin.id, ...tokens };
  }

  /** Public lookup used by the login page to resolve a tenant from its URL slug. */
  async findBySlug(slug: string) {
    const tenant = await this.db.system.getRepository(Tenant).findOneBy({ slug });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return { id: tenant.id, name: tenant.name, slug: tenant.slug, subscription_status: tenant.subscriptionStatus };
  }

  async findOne(id: string, user: AuthUser) {
    if (id !== user.tenantId) throw new ForbiddenException('You do not have access to this tenant');

    return this.db.run(user.tenantId, async (m) => {
      const tenant = await m.getRepository(Tenant).findOneByOrFail({ id });
      const company = await m.getRepository(Company).findOneBy({ tenantId: id });
      const subscription = await m.getRepository(Subscription).findOne({
        where: { tenantId: id },
        order: { createdAt: 'DESC' },
      });
      return { ...tenant, company, subscription };
    });
  }
}
