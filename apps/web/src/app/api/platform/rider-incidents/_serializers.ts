/**
 * Serializer for RiderIncidentReport rows. Lives outside `route.ts` because a
 * Next.js route file may only export HTTP handlers + route config.
 */
export function serializeIncident(i: any) {
  return {
    id: i.id,
    riderId: i.riderId,
    assignmentId: i.assignmentId ?? null,
    type: i.type,
    status: i.status,
    description: i.description,
    lat: i.lat == null ? null : Number(i.lat),
    lng: i.lng == null ? null : Number(i.lng),
    photoUrl: i.photoUrl ?? null,
    resolution: i.resolution ?? null,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    rider: {
      id: i.rider?.id ?? i.riderId,
      name: i.rider?.user?.name ?? null,
      phone: i.rider?.user?.phone ?? null,
    },
  };
}
