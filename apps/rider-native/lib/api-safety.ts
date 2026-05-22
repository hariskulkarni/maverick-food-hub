/**
 * Safety & SOS API module for the Flavrly rider app.
 *
 * Wraps the /api/rider/sos, /emergency-contacts, /incidents and /trip-share
 * endpoints. Auth-header plumbing is handled by `apiRequest` from lib/api.ts —
 * this module just defines the typed request/response shapes and the `safety`
 * call surface the Safety Centre screens use.
 */
import { apiRequest } from './api';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SosStatus = 'ACTIVE' | 'RESOLVED' | 'CANCELLED';

export interface SosAlert {
  id: string;
  assignmentId: string | null;
  lat: number | null;
  lng: number | null;
  status: SosStatus;
  note: string | null;
  triggeredAt: string;
  resolvedAt: string | null;
  resolvedNote: string | null;
}

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relation: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export type IncidentType =
  | 'ACCIDENT'
  | 'HARASSMENT'
  | 'VEHICLE_BREAKDOWN'
  | 'THEFT'
  | 'UNSAFE_LOCATION'
  | 'CUSTOMER_DISPUTE'
  | 'OTHER';

export type IncidentStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'CLOSED';

export interface IncidentReport {
  id: string;
  assignmentId: string | null;
  type: IncidentType;
  status: IncidentStatus;
  description: string;
  lat: number | null;
  lng: number | null;
  photoUrl: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TripShare {
  token: string;
  shareUrl: string;
  expiresAt: string;
}

export interface ActiveTripShare extends TripShare {
  assignmentId: string | null;
  createdAt: string;
}

// ─── Request payload shapes ──────────────────────────────────────────────────

export interface TriggerSosInput {
  lat?: number;
  lng?: number;
  assignmentId?: string;
  note?: string;
}

export interface ContactInput {
  name: string;
  phone: string;
  relation?: string;
  isPrimary?: boolean;
}

export interface ReportIncidentInput {
  type: IncidentType;
  description: string;
  lat?: number;
  lng?: number;
  assignmentId?: string;
  photoUrl?: string;
}

// ─── Call surface ────────────────────────────────────────────────────────────

export const safety = {
  /** Fire a panic alert. Returns the ACTIVE alert (existing one if already triggered). */
  triggerSos: (input: TriggerSosInput) =>
    apiRequest<{ alert: SosAlert; alreadyActive: boolean }>('/api/rider/sos', {
      method: 'POST',
      body: input,
    }),

  /** The rider's currently ACTIVE alert, or `{ active: null }`. */
  activeSos: () => apiRequest<{ active: SosAlert | null }>('/api/rider/sos'),

  /** Mark an alert resolved ("I'm safe"). */
  resolveSos: (id: string, resolvedNote?: string) =>
    apiRequest<{ alert: SosAlert }>(`/api/rider/sos/${id}/resolve`, {
      method: 'POST',
      body: { resolvedNote },
    }),

  /** The rider's emergency contacts, primary first. */
  contacts: () =>
    apiRequest<{ contacts: EmergencyContact[] }>('/api/rider/emergency-contacts'),

  /** Add an emergency contact. */
  addContact: (input: ContactInput) =>
    apiRequest<{ contact: EmergencyContact }>('/api/rider/emergency-contacts', {
      method: 'POST',
      body: input,
    }),

  /** Update an emergency contact. */
  updateContact: (id: string, patch: Partial<ContactInput>) =>
    apiRequest<{ contact: EmergencyContact }>(`/api/rider/emergency-contacts/${id}`, {
      method: 'PATCH',
      body: patch,
    }),

  /** Remove an emergency contact. */
  deleteContact: (id: string) =>
    apiRequest<{ ok: true }>(`/api/rider/emergency-contacts/${id}`, {
      method: 'DELETE',
    }),

  /** The rider's incident reports, newest first. */
  incidents: () =>
    apiRequest<{ incidents: IncidentReport[] }>('/api/rider/incidents'),

  /** File a new incident report. */
  reportIncident: (input: ReportIncidentInput) =>
    apiRequest<{ incident: IncidentReport }>('/api/rider/incidents', {
      method: 'POST',
      body: input,
    }),

  /** Start a shareable live-trip link (4-hour expiry). */
  createTripShare: (assignmentId?: string) =>
    apiRequest<TripShare>('/api/rider/trip-share', {
      method: 'POST',
      body: { assignmentId },
    }),

  /** The rider's active, non-expired live-trip share, or `{ share: null }`. */
  activeTripShare: () =>
    apiRequest<{ share: ActiveTripShare | null }>('/api/rider/trip-share'),
};
