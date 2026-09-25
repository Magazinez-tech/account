import { Global, Injectable, Module } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';

/**
 * Runs work inside a transaction scoped to one tenant.
 *
 * `SET LOCAL ROLE app_user` drops superuser privileges so the RLS policies from
 * EnableRowLevelSecurity apply; `app.tenant_id` is what those policies compare against.
 * Both settings are LOCAL, so they end with the transaction and never leak to other
 * requests sharing the pooled connection.
 */
@Injectable()
export class TenantDb {
  constructor(private readonly dataSource: DataSource) {}

  run<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SET LOCAL ROLE app_user');
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return work(manager);
    });
  }

  /**
   * Bypasses RLS. Only for lookups that must happen before a tenant is known
   * (slug lookup, slug availability) — never for tenant data.
   */
  get system(): EntityManager {
    return this.dataSource.manager;
  }
}

@Global()
@Module({ providers: [TenantDb], exports: [TenantDb] })
export class DatabaseModule {}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err.driverError as { code?: string })?.code === '23505';
}
