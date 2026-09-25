import { assessDbRole, DbRole } from './db-role-check';

const role = (r: Partial<DbRole>): DbRole => ({ name: 'accounting_app', superuser: false, bypassRls: false, canSetAppUser: true, ...r });
const PROD = { NODE_ENV: 'production' };

describe('assessDbRole', () => {
  it('accepts the least-privilege role everywhere', () => {
    expect(assessDbRole(role({}), PROD)).toEqual({ level: 'ok' });
    expect(assessDbRole(role({}), {})).toEqual({ level: 'ok' });
  });

  it('refuses a role that cannot SET ROLE app_user, in any environment', () => {
    expect(assessDbRole(role({ canSetAppUser: false }), {})).toMatchObject({ level: 'fatal', message: expect.stringMatching(/cannot SET ROLE app_user/) });
  });

  it('refuses superusers and BYPASSRLS roles in production', () => {
    expect(assessDbRole(role({ name: 'postgres', superuser: true }), PROD)).toMatchObject({ level: 'fatal', message: expect.stringMatching(/superuser/) });
    expect(assessDbRole(role({ bypassRls: true }), PROD)).toMatchObject({ level: 'fatal', message: expect.stringMatching(/BYPASSRLS/) });
  });

  it('only warns about them in development', () => {
    expect(assessDbRole(role({ name: 'postgres', superuser: true }), { NODE_ENV: 'development' }).level).toBe('warn');
  });

  it('lets production opt in explicitly', () => {
    expect(assessDbRole(role({ superuser: true }), { ...PROD, DB_ALLOW_PRIVILEGED_ROLE: 'true' }).level).toBe('warn');
  });
});
