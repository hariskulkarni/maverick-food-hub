import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/server/tenancy';
import { prisma } from '@/server/db';

/**
 * Super-admin: fetch the rider's currently-in-flight assignment, expanded
 * with the order, customer, branch+restaurant, and delivery address so the
 * Live Tracking side panel can render a full picture in one fetch.
 *
 * Returns `null` if the rider is idle (no PENDING/ACCEPTED/PICKED_UP work).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id: riderId } = await params;

  const assignment = await prisma.riderAssignment.findFirst({
    where: { riderId, status: { in: ['PENDING', 'ACCEPTED', 'PICKED_UP'] } },
    orderBy: { assignedAt: 'desc' },
    include: {
      order: {
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          address: true,
          branch: {
            select: {
              id: true, name: true, latitude: true, longitude: true,
              line1: true, city: true,
              restaurant: { select: { id: true, name: true } }
            }
          }
        }
      },
      rider: {
        select: {
          id: true, currentLat: true, currentLng: true, vehicleType: true,
          vehicleNumber: true, user: { select: { name: true, phone: true } }
        }
      }
    }
  });

  if (!assignment) return Response.json(null);
  return Response.json(assignment);
}
