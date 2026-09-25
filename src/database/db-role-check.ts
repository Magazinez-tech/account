export interface DbRole {
  name: string;
  superuser: boolean;
  bypassRls: boolean;
  /** May run SET ROLE app_user (required by TenantDb.run). */
  canSetAppUser: boolean;
}

export type DbRoleVerdict = { level: 'ok' } | { level: 'warn' | 'fatal'; message: string };

/**
 * Decides whether the API may run as the connected database role. Superusers and BYPASSRLS roles
 * make every RLS policy moot, so production refuses them unless DB_ALLOW_PRIVILEGED_ROLE=true.
 */
export function assessDbRole(role: DbRole, env: NodeJS.ProcessEnv): DbRoleVerdict {
  if (!role.canSetAppUser) {
    return {
      level: 'fatal',
      message: `Database role "${role.name}" cannot SET ROLE app_user. Run the migrations, then db/create-app-login.sql for this role.`,
    };
  }
  if (role.superuser || role.bypassRls) {
    const what = role.superuser ? 'a superuser' : 'a BYPASSRLS role';
    if (env.NODE_ENV === 'production' && env.DB_ALLOW_PRIVILEGED_ROLE !== 'true') {
      return {
        level: 'fatal',
        message: `Refusing to start: database role "${role.name}" is ${what}, which bypasses row-level security outside tenant transactions. Connect as the role from db/create-app-login.sql (or set DB_ALLOW_PRIVILEGED_ROLE=true).`,
      };
    }
    return {
      level: 'warn',
      message: `Database role "${role.name}" is ${what}; fine for development, but production should use db/create-app-login.sql.`,
    };
  }
  return { level: 'ok' };
}
