import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Tenant, User } from '../database/entities';
import { TenantDb } from '../database/tenant-db.service';
import { AuthUser, JwtPayload } from './jwt-auth.guard';
import { LoginDto } from './auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly db: TenantDb,
  ) {}

  async issueTokens(user: { id: string; tenantId: string; email: string }) {
    const expiresIn = this.config.get<string>('JWT_EXPIRATION', '24h');
    const refreshExpiresIn = this.config.get<string>('JWT_REFRESH_EXPIRATION', '7d');
    const base = { sub: user.id, tenantId: user.tenantId, email: user.email };

    const accessToken = await this.jwt.signAsync({ ...base, typ: 'access' }, {
      expiresIn: expiresIn as JwtSignOptions['expiresIn'],
    });
    const refreshToken = await this.jwt.signAsync({ ...base, typ: 'refresh' }, {
      expiresIn: refreshExpiresIn as JwtSignOptions['expiresIn'],
    });
    return { accessToken, refreshToken, expiresIn };
  }

  async login(dto: LoginDto) {
    const tenantId = dto.tenantId ?? (dto.tenantSlug ? await this.tenantIdForSlug(dto.tenantSlug) : undefined);
    if (!tenantId) throw new BadRequestException('tenantId or tenantSlug is required');

    const user = await this.db.run(tenantId, async (m) => {
      const found = await m
        .getRepository(User)
        .createQueryBuilder('u')
        .addSelect('u.passwordHash')
        .where('u.email = :email', { email: dto.email.toLowerCase() })
        .getOne();
      if (!found || !found.isActive || !(await bcrypt.compare(dto.password, found.passwordHash))) return null;
      await m.getRepository(User).update(found.id, { lastLoginAt: new Date() });
      return found;
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    return {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      tenantId,
      ...(await this.issueTokens(user)),
    };
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException();
    }
    if (payload.typ !== 'refresh') throw new UnauthorizedException();

    const user = await this.db.run(payload.tenantId, (m) => m.getRepository(User).findOneBy({ id: payload.sub }));
    if (!user || !user.isActive) throw new UnauthorizedException();
    return this.issueTokens(user);
  }

  async me(auth: AuthUser) {
    return this.db.run(auth.tenantId, async (m) => {
      const user = await m.getRepository(User).findOneBy({ id: auth.userId });
      if (!user) throw new NotFoundException('User not found');
      const roles: { name: string }[] = await m.query(
        `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.name`,
        [user.id],
      );
      return {
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
        tenantId: user.tenantId,
        roles: roles.map((r) => r.name),
      };
    });
  }

  private async tenantIdForSlug(slug: string): Promise<string> {
    const tenant = await this.db.system.getRepository(Tenant).findOneBy({ slug });
    // Same error as a bad password so slugs can't be probed through login.
    if (!tenant) throw new UnauthorizedException('Invalid credentials');
    return tenant.id;
  }
}
