/**
 * Dispatch & Navigation API module — heatmap, shift booking, and rider
 * dispatch preferences. Built on the shared `apiRequest` helper so the Bearer
 * token, JSON in/out, and `ApiError` handling are all inherited.
 *
 * Backed by:
 *   GET    /api/rider/heatmap
 *   GET    /api/rider/shifts
 *   POST   /api/rider/shifts
 *   PATCH  /api/rider/shifts/[id]
 *   DELETE /api/rider/shifts/[id]
 *   GET    /api/rider/preferences
 *   PATCH  /api/rider/preferences
 */
import { apiRequest } from './api';

// ─── Heatmap ─────────────────────────────────────────────────────────────────

export type DemandIntensity = 'LOW' | 'MEDIUM' | 'HIGH';

/** One pickup branch with open orders, plotted on the demand map. */
export interface HeatmapPoint {
  name: string;
  lat: number;
  lng: number;
  count: number;
  intensity: DemandIntensity;
}

export interface HeatmapResponse {
  points: HeatmapPoint[];
  /** Total open orders across all points. */
  totalOpen: number;
  generatedAt: string;
}

// ─── Shifts ──────────────────────────────────────────────────────────────────

export type ShiftStatus = 'BOOKED' | 'STARTED' | 'COMPLETED' | 'MISSED' | 'CANCELLED';

/** A booked work slot. `date` is an ISO string; times are "HH:MM" local. */
export interface Shift {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  zoneName: string | null;
  status: ShiftStatus;
}

export interface ShiftsResponse {
  shifts: Shift[];
}

export interface BookShiftInput {
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  startTime: string;
  /** "HH:MM" */
  endTime: string;
  zoneName?: string | null;
}

// ─── Preferences ─────────────────────────────────────────────────────────────

/** Per-rider dispatch preferences + break mode. One row per rider. */
export interface RiderPreferences {
  autoAccept: boolean;
  maxBatchSize: number;
  notifyRadiusKm: number;
  preferredZones: string[];
  breakMode: boolean;
  /** ISO string while on a timed break, else null. */
  breakUntil: string | null;
  updatedAt: string;
}

export interface PreferencesResponse {
  preferences: RiderPreferences;
}

/** Any subset of the editable preference fields. */
export interface PreferencesPatch {
  autoAccept?: boolean;
  maxBatchSize?: number;
  notifyRadiusKm?: number;
  preferredZones?: string[];
  breakMode?: boolean;
  breakUntil?: string | null;
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

export const dispatch = {
  /** Live demand heatmap — open orders grouped by pickup branch. */
  heatmap: () => apiRequest<HeatmapResponse>('/api/rider/heatmap'),

  /** This rider's upcoming shifts, soonest first. */
  shifts: () => apiRequest<ShiftsResponse>('/api/rider/shifts'),

  /** Book a new shift slot. */
  bookShift: (input: BookShiftInput) =>
    apiRequest<{ shift: Shift }>('/api/rider/shifts', {
      method: 'POST',
      body: input,
    }),

  /** Advance a shift's status (e.g. BOOKED→STARTED→COMPLETED, or →CANCELLED). */
  updateShift: (id: string, status: ShiftStatus) =>
    apiRequest<{ shift: Shift }>(`/api/rider/shifts/${id}`, {
      method: 'PATCH',
      body: { status },
    }),

  /** Delete a still-BOOKED shift. */
  cancelShift: (id: string) =>
    apiRequest<{ ok: true }>(`/api/rider/shifts/${id}`, { method: 'DELETE' }),

  /** The rider's dispatch preferences (created with defaults on first read). */
  preferences: () => apiRequest<PreferencesResponse>('/api/rider/preferences'),

  /** Update any subset of dispatch preferences. */
  updatePreferences: (patch: PreferencesPatch) =>
    apiRequest<PreferencesResponse>('/api/rider/preferences', {
      method: 'PATCH',
      body: patch,
    }),
};
