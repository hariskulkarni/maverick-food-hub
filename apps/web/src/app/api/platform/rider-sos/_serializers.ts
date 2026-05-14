/**
 * Serializer for SosAlert rows. Lives outside `route.ts` because a Next.js
 * route file may only export HTTP handlers + route config — not helpers.
 */
export function serializeSos(a: any) {
  return {
    id: a.id,
    riderId: a.riderId,
    assignmentId: a.assignmentId ?? null,
    lat: a.lat == null ? null : Number(a.lat),
    lng: a.lng == null ? null : Number(a.lng),
    status: a.status,
    note: a.note ?? null,
    triggeredAt: a.triggeredAt.toISOString(),
    resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
    resolvedNote: a.resolvedNote ?? null,
    rider: {
      id: a.rider?.id ?? a.riderId,
      name: a.rider?.user?.name ?? null,
      phone: a.rider?.user?.phone ?? null,
    },
  };
}
