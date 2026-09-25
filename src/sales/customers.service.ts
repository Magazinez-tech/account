import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../auth/jwt-auth.guard';
import { definedFields } from '../common/defined';
import { Customer } from '../database/entities';
import { TenantDb } from '../database/tenant-db.service';
import { CreateCustomerDto, UpdateCustomerDto } from './sales.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly db: TenantDb) {}

  list(user: AuthUser, includeInactive: boolean) {
    return this.db.run(user.tenantId, (m) =>
      m.getRepository(Customer).find({ where: includeInactive ? {} : { isActive: true }, order: { name: 'ASC' } }),
    );
  }

  get(user: AuthUser, id: string) {
    return this.db.run(user.tenantId, async (m) => {
      const customer = await m.getRepository(Customer).findOneBy({ id });
      if (!customer) throw new NotFoundException('Customer not found');
      return customer;
    });
  }

  create(user: AuthUser, dto: CreateCustomerDto) {
    return this.db.run(user.tenantId, (m) => m.getRepository(Customer).save({ ...dto, name: dto.name.trim(), tenantId: user.tenantId }));
  }

  update(user: AuthUser, id: string, dto: UpdateCustomerDto) {
    return this.db.run(user.tenantId, async (m) => {
      const repo = m.getRepository(Customer);
      const customer = await repo.findOneBy({ id });
      if (!customer) throw new NotFoundException('Customer not found');
      // Partial updates allow null, which only clears the optional fields.
      const { name, creditDays, isActive, ...optional } = definedFields(dto);
      return repo.save({
        ...customer,
        ...optional,
        ...(name != null && { name: name.trim() }),
        ...(creditDays != null && { creditDays }),
        ...(isActive != null && { isActive }),
      });
    });
  }
}
