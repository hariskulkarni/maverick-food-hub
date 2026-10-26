/**
 * Test helper: given the stub a test already uses for requireManagedRestaurant /
 * requireRestaurant, build matching stubs for the admin-only gates
 * requireTenantAdmin (throws) and tenantAdminOrError (returns the Response).
 */
export function tenantAdminMocks(gate: (restaurantId?: string | null) => Promise<any>) {
  return {
    requireTenantAdmin: (restaurantId?: string | null) => gate(restaurantId),
    tenantAdminOrError: async (restaurantId?: string | null) => {
      try {
        return await gate(restaurantId);
      } catch (e) {
        if (e instanceof Response) return e;
        throw e;
      }
    },
  };
}
