import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, session } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url, auth: (init as RequestInit).headers as Record<string, string> }));

describe('api', () => {
  it('sends the access token and JSON body', async () => {
    session.save({ accessToken: 'A1', refreshToken: 'R1' });
    fetchMock.mockResolvedValueOnce(json(201, { id: 'x' }));

    await expect(api('/accounts', { method: 'POST', body: { code: '1020' } })).resolves.toEqual({ id: 'x' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/accounts');
    expect(init).toMatchObject({ method: 'POST', body: '{"code":"1020"}' });
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer A1' });
  });

  it('omits the token for public endpoints', async () => {
    session.save({ accessToken: 'A1', refreshToken: 'R1' });
    fetchMock.mockResolvedValueOnce(json(200, {}));
    await api('/invites/abc', { auth: false });
    expect(calls()[0].auth).toEqual({});
  });

  it('translates known server messages to Thai', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { statusCode: 401, message: 'Invalid credentials' }));
    await expect(api('/auth/login', { method: 'POST', auth: false, body: {} })).rejects.toMatchObject({
      status: 401,
      message: 'รหัสบริษัท อีเมล หรือรหัสผ่านไม่ถูกต้อง',
    });
  });

  it('joins validation message arrays and passes unknown messages through', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { message: ['code must be 1-20 letters', 'name must be a string'] }));
    const err = await api('/accounts', { method: 'POST', body: {} }).catch((e: ApiError) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('code must be 1-20 letters, name must be a string');
  });

  it('falls back to the status line when the body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>oops</html>', { status: 502, statusText: 'Bad Gateway' }));
    await expect(api('/accounts')).rejects.toMatchObject({ status: 502, message: '502 Bad Gateway' });
  });

  it('refreshes an expired access token once and retries', async () => {
    session.save({ accessToken: 'OLD', refreshToken: 'R1' });
    fetchMock
      .mockResolvedValueOnce(json(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'NEW', refreshToken: 'R2' }))
      .mockResolvedValueOnce(json(200, ['ok']));

    await expect(api('/accounts')).resolves.toEqual(['ok']);
    expect(calls().map((c) => c.url)).toEqual(['/api/v1/accounts', '/api/v1/auth/refresh', '/api/v1/accounts']);
    expect(calls()[2].auth.Authorization).toBe('Bearer NEW');
    expect(session.access).toBe('NEW');
    expect(session.refresh).toBe('R2');
  });

  it('shares one refresh between concurrent 401s', async () => {
    session.save({ accessToken: 'OLD', refreshToken: 'R1' });
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url === '/api/v1/auth/refresh') return json(200, { accessToken: 'NEW', refreshToken: 'R2' });
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer NEW' ? json(200, url) : json(401, {});
    });

    await Promise.all([api('/accounts'), api('/journal-entries'), api('/reports/trial-balance')]);
    expect(calls().filter((c) => c.url === '/api/v1/auth/refresh')).toHaveLength(1);
  });

  it('signs out when the refresh token is rejected', async () => {
    session.save({ accessToken: 'OLD', refreshToken: 'EXPIRED' });
    const onLogout = vi.fn();
    window.addEventListener('auth:logout', onLogout);
    fetchMock.mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(401, {}));

    await expect(api('/accounts')).rejects.toMatchObject({ status: 401 });
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(session.access).toBeNull();
    expect(session.refresh).toBeNull();
    window.removeEventListener('auth:logout', onLogout);
  });

  it('does not try to refresh on a failed public call', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { message: 'Invalid credentials' }));
    await expect(api('/auth/login', { method: 'POST', auth: false, body: {} })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns undefined for 204 No Content', async () => {
    session.save({ accessToken: 'A1', refreshToken: 'R1' });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api('/invitations/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});
