import { describe, it, expect } from "vitest";
import { pointInPolygon, haversineKm } from "@/server/delivery/geo-util";

// Rings are [lng, lat]. Convention: boundary points (vertex/edge) are
// deterministic per the ray-casting half-open rule (see geo-util.ts):
// the left/bottom boundary is inside, the right/top boundary is outside.
const square: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];
const closedSquare: [number, number][] = [...square, [0, 0]];

// Concave "U" shape: notch cut from the top between x=4..6, y=5..10.
const concave: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [6, 10],
  [6, 5],
  [4, 5],
  [4, 10],
  [0, 10],
];

describe("pointInPolygon", () => {
  it("returns true for a point inside a square", () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
  });
  it("returns false for points outside a square", () => {
    expect(pointInPolygon(15, 5, square)).toBe(false);
    expect(pointInPolygon(-1, 5, square)).toBe(false);
    expect(pointInPolygon(5, 11, square)).toBe(false);
    expect(pointInPolygon(5, -1, square)).toBe(false);
  });
  it("treats open and closed rings identically", () => {
    expect(pointInPolygon(5, 5, closedSquare)).toBe(true);
    expect(pointInPolygon(15, 5, closedSquare)).toBe(false);
  });
  it("is deterministic on vertices (documented convention)", () => {
    expect(pointInPolygon(0, 0, square)).toBe(true);
    expect(pointInPolygon(10, 10, square)).toBe(false);
    expect(pointInPolygon(0, 0, closedSquare)).toBe(pointInPolygon(0, 0, square));
    expect(pointInPolygon(10, 10, closedSquare)).toBe(pointInPolygon(10, 10, square));
  });
  it("is deterministic on edges (documented convention)", () => {
    expect(pointInPolygon(0, 5, square)).toBe(true); // left edge inside
    expect(pointInPolygon(10, 5, square)).toBe(false); // right edge outside
    expect(pointInPolygon(5, 0, square)).toBe(true); // bottom edge inside
    expect(pointInPolygon(5, 10, square)).toBe(false); // top edge outside
  });
  it("excludes the concave notch and includes the arms", () => {
    expect(pointInPolygon(5, 8, concave)).toBe(false);
    expect(pointInPolygon(5, 2, concave)).toBe(true);
    expect(pointInPolygon(2, 8, concave)).toBe(true);
    expect(pointInPolygon(8, 8, concave)).toBe(true);
  });
  it("returns false for degenerate rings", () => {
    expect(pointInPolygon(0, 0, [])).toBe(false);
    expect(pointInPolygon(0, 0, [[0, 0], [1, 1]])).toBe(false);
  });
});

describe("haversineKm", () => {
  it("is zero for identical points", () => {
    expect(haversineKm({ lat: 12.9, lng: 77.6 }, { lat: 12.9, lng: 77.6 })).toBe(0);
  });
  it("matches London-Paris (~343.5 km) within 1%", () => {
    const d = haversineKm({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 });
    expect(Math.abs(d - 343.5) / 343.5).toBeLessThan(0.01);
  });
  it("matches one degree of latitude (~111.19 km) within 1%", () => {
    const d = haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(Math.abs(d - 111.19) / 111.19).toBeLessThan(0.01);
  });
  it("is symmetric", () => {
    const a = { lat: 40.7128, lng: -74.006 };
    const b = { lat: 34.0522, lng: -118.2437 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });
});
