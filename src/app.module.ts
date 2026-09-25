import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AccountingModule } from './accounting/accounting.module';
import { AuthModule } from './auth/auth.module';
import { dataSourceOptions } from './database/data-source';
import { DatabaseModule } from './database/tenant-db.service';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { BillingModule } from './billing/billing.module';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  /** Liveness and database check (served at /health, outside /api/v1). */
  @Get()
  @ApiServiceUnavailableResponse({ description: 'Database unreachable' })
  async check() {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Factory runs after ConfigModule has loaded .env into process.env.
    TypeOrmModule.forRootAsync({ useFactory: () => dataSourceOptions() }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.getOrThrow<string>('JWT_SECRET');
        if (secret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
        return { secret };
      },
    }),
    // Storage and defaults for @RateLimit (per-route limits are set there).
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }], errorMessage: 'Too many requests' }),
    DatabaseModule,
    AuthModule,
    TenantsModule,
    AccountingModule,
    UsersModule,
    BillingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
