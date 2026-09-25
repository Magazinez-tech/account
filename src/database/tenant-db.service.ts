import { Global, Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { assessDbRole } from './db-role-check';

/**
 * Runs work inside a transaction scoped to one tenant.
 *
 * `SET LOCAL ROLE app_user` drops to a role the RLS policies from EnableRowLevelSecurity apply to;
 * `app.tenant_id` is what those policies compare against. Both settings are LOCAL, so they end
 * with the transaction and never leak to other requests sharing the pooled connection.
 */
@Injectable()
export class TenantDb implements OnApplicationBootstrap {
  private readonly logger = new Logger(TenantDb.name);

  constructor(private readonly dataSource: DataSource) {}

  run<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SET LOCAL ROLE app_user');
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return work(manager);
    });
  }

  /**
   * Runs as the connection's own role, outside any tenant. Only for lookups that must happen before
   * a tenant is known (slug, invite token, payment charge) and the login lockout table. In
   * production that role (db/create-app-login.sql) can read nothing else.
   */
  get system(): EntityManager {
    return this.dataSource.manager;
  }

  /** Refuses to serve with a role that would silently bypass tenant isolation (see assessDbRole). */
  async onApplicationBootstrap() {
    const [row]: { name: string; superuser: boolean; bypass_rls: boolean; can_set_app_user: boolean }[] =
      await this.dataSource.query(
        `SELECT current_user AS name, rolsuper AS superuser, rolbypassrls AS bypass_rls,
                pg_has_role(current_user, 'app_user', 'SET') AS can_set_app_user
           FROM pg_roles WHERE rolname = current_user`,
      );
    const verdict = assessDbRole(
      { name: row.name, superuser: row.superuser, bypassRls: row.bypass_rls, canSetAppUser: row.can_set_app_user },
      process.env,
    );
    if (verdict.level === 'fatal') throw new Error(verdict.message);
    if (verdict.level === 'warn') this.logger.warn(verdict.message);
    else this.logger.log(`Database role "${row.name}": least privilege (RLS enforced)`);
  }
}

@Global()
@Module({ providers: [TenantDb], exports: [TenantDb] })
export class DatabaseModule {}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err.driverError as { code?: string })?.code === '23505';
}
