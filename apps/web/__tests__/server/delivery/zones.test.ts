import { describe, it, expect, vi, beforeEach } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/server/db", () => ({ prisma: { deliveryZone: { findMany } } }));

import { matchZone, computeZoneDelivery } from "@/server/delivery/zones";

const base = {
  branchId: "b1",
  isActive: true,
  isDefault: false,
  priority: 100,
  polygon: null,
  centerLat: null,
  centerLng: null,
  radiusKm: null,
  pincodes: [] as string[],
  feeBrackets: [],
  distanceTiers: [],
  minOrder: null,
  etaMinutes: null,
};
const z = (o: Record<string, unknown>) => ({ ...base, id: "z", name: "z", ...o }) as any;

const square = [[0, 0], [10, 0], [10, 10], [0, 10]];

beforeEach(() => findMany.mockReset());

describe("matchZone", () => {
  it("queries active zones for branch ordered by priority asc", async () => {
    findMany.mockResolvedValue([]);
    await matchZone("b1", { lat: 1, lng: 1 });
    expect(findMany).toHaveBeenCalledWith({
      where: { branchId: "b1", isActive: true },
      orderBy: { priority: "asc" },
    });
  });

  it("returns null when no zones", async () => {
    findMany.mockResolvedValue([]);
    expect(await matchZone("b1", { lat: 1, lng: 1 })).toBeNull();
  });

  it("matches POLYGON", async () => {
    const zone = z({ id: "p", type: "POLYGON", polygon: square });
    findMany.mockResolvedValue([zone]);
    expect(await matchZone("b1", { lat: 5, lng: 5 })).toBe(zone);
    expect(await matchZone("b1", { lat: 50, lng: 50 })).toBeNull();
  });

  it("matches CIRCLE", async () => {
    const zone = z({ id: "c", type: "CIRCLE", centerLat: 12.97, centerLng: 77.59, radiusKm: 3 });
    findMany.mockResolvedValue([zone]);
    expect(await matchZone("b1", { lat: 12.98, lng: 77.6 })).toBe(zone);
    expect(await matchZone("b1", { lat: 13.5, lng: 77.59 })).toBeNull();
  });

  it("matches PINCODE", async () => {
    const zone = z({ id: "x", type: "PINCODE", pincodes: ["560001"] });
    findMany.mockResolvedValue([zone]);
    expect(await matchZone("b1", { lat: 0, lng: 0, pincode: "560001" })).toBe(zone);
    expect(await matchZone("b1", { lat: 0, lng: 0, pincode: "560002" })).toBeNull();
    expect(await matchZone("b1", { lat: 0, lng: 0 })).toBeNull();
  });

  it("returns first match in priority order across types", async () => {
    const circle = z({ id: "c", type: "CIRCLE", centerLat: 5, centerLng: 5, radiusKm: 1000 });
    const poly = z({ id: "p", type: "POLYGON", polygon: square });
    const pin = z({ id: "x", type: "PINCODE", pincodes: ["1"] });
    findMany.mockResolvedValue([pin, circle, poly]);
    expect((await matchZone("b1", { lat: 5, lng: 5, pincode: "1" }))!.id).toBe("x");
    expect((await matchZone("b1", { lat: 5, lng: 5, pincode: "2" }))!.id).toBe("c");
  });

  it("falls back to isDefault zone when nothing matches", async () => {
    const poly = z({ id: "p", type: "POLYGON", polygon: square });
    const def = z({ id: "d", type: "PINCODE", isDefault: true });
    findMany.mockResolvedValue([poly, def]);
    expect((await matchZone("b1", { lat: 50, lng: 50 }))!.id).toBe("d");
  });

  it("geometry match beats earlier-priority default", async () => {
    const def = z({ id: "d", type: "PINCODE", isDefault: true });
    const poly = z({ id: "p", type: "POLYGON", polygon: square });
    findMany.mockResolvedValue([def, poly]);
    expect((await matchZone("b1", { lat: 5, lng: 5 }))!.id).toBe("p");
  });
});

describe("computeZoneDelivery", () => {
  const brackets = [
    { minSubtotal: 0, charge: 4000 },
    { minSubtotal: 30000, charge: 2000 },
    { minSubtotal: 60000, charge: 0 },
    { minSubtotal: 200000, charge: -1 },
  ];

  it("selects highest bracket not above subtotal (unsorted input)", () => {
    const zone = z({ feeBrackets: [brackets[2], brackets[0], brackets[3], brackets[1]] });
    expect(computeZoneDelivery(zone, 10000, 0).feePaise).toBe(4000);
    expect(computeZoneDelivery(zone, 30000, 0).feePaise).toBe(2000);
    expect(computeZoneDelivery(zone, 59999, 0).feePaise).toBe(2000);
  });

  it("charge 0 is free", () => {
    const r = computeZoneDelivery(z({ feeBrackets: brackets }), 60000, 0);
    expect(r).toMatchObject({ available: true, feePaise: 0 });
  });

  it("charge -1 is unavailable", () => {
    const r = computeZoneDelivery(z({ feeBrackets: brackets }), 200000, 0);
    expect(r.available).toBe(false);
    expect(r.feePaise).toBe(0);
  });

  it("no matching bracket or empty/garbage JSON => fee 0, available", () => {
    expect(computeZoneDelivery(z({ feeBrackets: [] }), 100, 1)).toMatchObject({ available: true, feePaise: 0 });
    expect(computeZoneDelivery(z({ feeBrackets: "nope", distanceTiers: null }), 100, 1)).toMatchObject({
      available: true,
      feePaise: 0,
    });
    expect(computeZoneDelivery(z({ feeBrackets: [{ minSubtotal: 500, charge: 900 }] }), 100, 1).feePaise).toBe(0);
  });

  it("distance tier is additive; first tier by uptoKm asc with distance<=uptoKm", () => {
    const zone = z({
      feeBrackets: [{ minSubtotal: 0, charge: 3000 }],
      distanceTiers: [
        { uptoKm: 10, charge: 5000 },
        { uptoKm: 3, charge: 0 },
        { uptoKm: 5, charge: 1500 },
      ],
    });
    expect(computeZoneDelivery(zone, 100, 2).feePaise).toBe(3000);
    expect(computeZoneDelivery(zone, 100, 5).feePaise).toBe(4500);
    expect(computeZoneDelivery(zone, 100, 7).feePaise).toBe(8000);
    expect(computeZoneDelivery(zone, 100, 11).feePaise).toBe(3000);
  });

  it("free bracket still adds distance tier", () => {
    const zone = z({
      feeBrackets: [{ minSubtotal: 0, charge: 0 }],
      distanceTiers: [{ uptoKm: 10, charge: 2500 }],
    });
    expect(computeZoneDelivery(zone, 100, 4).feePaise).toBe(2500);
  });

  it("minOrderPaise = max(zone rupees*100, branch paise)", () => {
    const zone = z({ minOrder: "150.50" });
    expect(computeZoneDelivery(zone, 0, 0).minOrderPaise).toBe(15050);
    expect(computeZoneDelivery(zone, 0, 0, 20000).minOrderPaise).toBe(20000);
    expect(computeZoneDelivery(zone, 0, 0, 100).minOrderPaise).toBe(15050);
    expect(computeZoneDelivery(z({}), 0, 0, 7000).minOrderPaise).toBe(7000);
    expect(computeZoneDelivery(z({}), 0, 0).minOrderPaise).toBe(0);
  });

  it("eta override vs default", () => {
    expect(computeZoneDelivery(z({ etaMinutes: 25 }), 0, 8).etaMinutes).toBe(25);
    // default: 20 + 4*km rounded
    expect(computeZoneDelivery(z({}), 0, 5).etaMinutes).toBe(40);
    expect(computeZoneDelivery(z({}), 0, 0).etaMinutes).toBe(20);
  });
});
