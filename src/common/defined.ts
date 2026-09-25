/**
 * The fields that were actually sent. DTO instances declare every property, so fields a PATCH left
 * out are present as undefined and would overwrite stored values when spread into an entity.
 */
export function definedFields<T extends object>(dto: T): Partial<T> {
  return Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<T>;
}
