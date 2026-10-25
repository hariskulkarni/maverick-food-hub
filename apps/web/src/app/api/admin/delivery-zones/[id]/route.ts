import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { requireManagedRestaurant } from "@/server/tenancy";
import { ZoneBody, zoneData, NO_BRACKETS_MESSAGE } from "@/server/delivery/zone-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function managed(req: NextRequest) {
  try {
    return { restaurant: await requireManagedRestaurant(req.nextUrl.searchParams.get("restaurantId")) };
  } catch (e) {
    if (e instanceof Response) return { error: e };
    throw e;
  }
}

/** The zone, only if its branch belongs to the caller's restaurant. */
async function findManagedZone(restaurantId: string, id: string) {
  const z = await prisma.deliveryZone.findUnique({ where: { id }, include: { branch: { select: { restaurantId: true } } } });
  return z && z.branch.restaurantId === restaurantId ? z : null;
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const m = await managed(req);
  if (m.error) return m.error;
  const { id } = await params;
  const existing = await findManagedZone(m.restaurant!.id, id);
  if (!existing) return new Response("Not found", { status: 404 });

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Response("Invalid body", { status: 400 });
  const { branch: _b, ...current } = existing as Record<string, unknown>;
  // Validate the merged result so geometry always matches the (possibly new) type.
  const parsed = ZoneBody.safeParse({ ...current, ...raw });
  if (!parsed.success) return Response.json({ error: "Invalid zone", issues: parsed.error.issues }, { status: 400 });
  const v = parsed.data;
  // Never let an edit strip every bracket — the zone would refuse every delivery.
  if (Array.isArray(v.feeBrackets) && v.feeBrackets.length === 0) {
    return Response.json({ error: NO_BRACKETS_MESSAGE, reason: "no_fee_brackets" }, { status: 400 });
  }

  if (v.branchId !== existing.branchId) {
    const dest = await prisma.branch.findUnique({ where: { id: v.branchId }, select: { restaurantId: true } });
    if (!dest || dest.restaurantId !== m.restaurant!.id) return new Response("Not found", { status: 404 });
  }

  const data = zoneData(v);
  const zone = await prisma.$transaction(async (tx) => {
    if (v.isDefault && (raw as Record<string, unknown>).isDefault !== undefined) {
      await tx.deliveryZone.updateMany({
        where: { branchId: v.branchId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }
    return tx.deliveryZone.update({ where: { id }, data: data as never });
  });
  return Response.json({ zone });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const m = await managed(req);
  if (m.error) return m.error;
  const { id } = await params;
  if (!(await findManagedZone(m.restaurant!.id, id))) return new Response("Not found", { status: 404 });
  await prisma.deliveryZone.delete({ where: { id } });
  return Response.json({ ok: true });
}
