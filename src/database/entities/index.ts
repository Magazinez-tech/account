import { Account, FiscalClosing, JournalEntry, JournalLine } from './accounting.entities';
import { Invoice, Payment, Subscription, SubscriptionPlan, SystemConfig } from './billing.entities';
import { Customer, SalesDocument, SalesDocumentLine } from './sales.entities';
import { Company, Role, Tenant, User, UserInvitation, UserRole } from './tenancy.entities';

export * from './accounting.entities';
export * from './billing.entities';
export * from './sales.entities';
export * from './tenancy.entities';

export const ENTITIES = [
  Tenant,
  Company,
  User,
  Role,
  UserRole,
  UserInvitation,
  Account,
  JournalEntry,
  JournalLine,
  FiscalClosing,
  SubscriptionPlan,
  Subscription,
  Invoice,
  Payment,
  SystemConfig,
  Customer,
  SalesDocument,
  SalesDocumentLine,
];
