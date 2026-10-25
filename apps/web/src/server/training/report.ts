/**
 * Training library v2 — completion reporting (platform dashboard, restaurant
 * team view, CSV export). Reuses computeModuleStatus so the dashboard and the
 * learner screens can never disagree about who is certified / overdue.
 */
import { prisma } from '@/server/db';
import { computeModuleStatus, type ModuleState } from './grading';
import { TRAINING_AUDIENCES, type TrainingAudience } from './types';

/** `?audience=` → one audience, or all of them for ALL/missing/unknown. */
export function parseAudiences(v: string | null): TrainingAudience[] {
  return v && (TRAINING_AUDIENCES as readonly string[]).includes(v) ? [v as TrainingAudience] : [...TRAINING_AUDIENCES];
}

export type ReportCellState = ModuleState | 'NOT_ASSIGNED';

export interface ReportLearner {
  userId: string;
  name: string;
  phone: string | null;
  audience: TrainingAudience;
  restaurant: string | null;
  requiredTotal: number;
  requiredCertified: number;
  overdue: number;
  cells: Record<
    string,
    { state: ReportCellState; overdue: boolean; bestScorePct: number | null; certifiedAt: string | null; certVersion: number | null; attempts: number; dueAt: string | null }
  >;
}

export interface ReportModule {
  id: string;
  title: string;
  audience: TrainingAudience;
  isRequired: boolean;
  isActive: boolean;
  version: number;
  learners: number;
  certified: number;
  attempts: number;
  passedAttempts: number;
  passRatePct: number | null;
  avgScorePct: number | null;
  overdue: number;
}

export interface TrainingReport {
  generatedAt: string;
  modules: ReportModule[];
  learners: ReportLearner[];
}

async function learnersFor(audiences: TrainingAudience[], restaurantId?: string) {
  const rows: { userId: string; name: string; phone: string | null; since: Date; audience: TrainingAudience; restaurant: string | null }[] = [];
  if (audiences.includes('RIDER') && !restaurantId) {
    const riders = await prisma.riderProfile.findMany({
      where: { user: { deletedAt: null } },
      select: { user: { select: { id: true, name: true, phone: true, createdAt: true } } },
    });
    for (const r of riders) {
      rows.push({ userId: r.user.id, name: r.user.name ?? r.user.phone ?? 'Rider', phone: r.user.phone, since: r.user.createdAt, audience: 'RIDER', restaurant: null });
    }
  }
  const staffRoles = [
    ...(audiences.includes('KITCHEN') ? (['KITCHEN'] as const) : []),
    ...(audiences.includes('RESTAURANT_ADMIN') ? (['ADMIN'] as const) : []),
  ];
  if (staffRoles.length) {
    const staff = await prisma.restaurantUser.findMany({
      where: {
        role: { in: [...staffRoles] },
        user: { deletedAt: null },
        ...(restaurantId ? { restaurantId } : {}),
      },
      select: {
        role: true,
        restaurant: { select: { name: true } },
        user: { select: { id: true, name: true, email: true, phone: true, createdAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const seen = new Set<string>();
    for (const s of staff) {
      if (seen.has(s.user.id)) continue; // one row per person even with several restaurant grants
      seen.add(s.user.id);
      rows.push({
        userId: s.user.id,
        name: s.user.name ?? s.user.email ?? s.user.phone ?? 'Staff',
        phone: s.user.phone,
        since: s.user.createdAt,
        audience: s.role === 'ADMIN' ? 'RESTAURANT_ADMIN' : 'KITCHEN',
        restaurant: s.restaurant.name,
      });
    }
  }
  return rows;
}

export async function buildTrainingReport(opts: {
  audiences: TrainingAudience[];
  restaurantId?: string;
  includeInactive?: boolean;
  now?: Date;
}): Promise<TrainingReport> {
  const now = opts.now ?? new Date();
  const [modules, learners] = await Promise.all([
    prisma.trainingModule.findMany({
      where: { audience: { in: opts.audiences }, ...(opts.includeInactive ? {} : { isActive: true }) },
      orderBy: [{ audience: 'asc' }, { order: 'asc' }],
      select: {
        id: true, title: true, audience: true, isRequired: true, isActive: true, version: true,
        versionPublishedAt: true, dueDays: true,
        lessons: { select: { id: true } },
        _count: { select: { questions: true } },
      },
    }),
    learnersFor(opts.audiences, opts.restaurantId),
  ]);
  const moduleIds = modules.map((m) => m.id);
  const userIds = learners.map((l) => l.userId);
  const [completions, attempts, certificates] = userIds.length && moduleIds.length
    ? await Promise.all([
        prisma.trainingLessonCompletion.findMany({ where: { userId: { in: userIds }, moduleId: { in: moduleIds } }, select: { userId: true, moduleId: true, lessonId: true, moduleVersion: true } }),
        prisma.trainingQuizAttempt.findMany({ where: { userId: { in: userIds }, moduleId: { in: moduleIds } }, select: { userId: true, moduleId: true, moduleVersion: true, passed: true, scorePct: true, createdAt: true } }),
        prisma.trainingCertificate.findMany({ where: { userId: { in: userIds }, moduleId: { in: moduleIds } }, select: { userId: true, moduleId: true, moduleVersion: true, issuedAt: true, scorePct: true, code: true } }),
      ])
    : [[], [], []];

  const group = <T extends { userId: string; moduleId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = `${r.userId}:${r.moduleId}`;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  };
  const cBy = group(completions);
  const aBy = group(attempts);
  const certBy = group(certificates);

  const moduleStats = new Map(modules.map((m) => [m.id, { learners: 0, certified: 0, overdue: 0 }]));
  const reportLearners: ReportLearner[] = learners.map((l) => {
    const cells: ReportLearner['cells'] = {};
    let requiredTotal = 0;
    let requiredCertified = 0;
    let overdue = 0;
    for (const m of modules) {
      // Riders see only RIDER modules; kitchen only KITCHEN; admins see both staff audiences.
      const visible =
        m.audience === l.audience || (l.audience === 'RESTAURANT_ADMIN' && m.audience === 'KITCHEN');
      if (!visible) {
        cells[m.id] = { state: 'NOT_ASSIGNED', overdue: false, bestScorePct: null, certifiedAt: null, certVersion: null, attempts: 0, dueAt: null };
        continue;
      }
      const required = m.isRequired && m.audience === l.audience;
      const key = `${l.userId}:${m.id}`;
      const st = computeModuleStatus({
        version: m.version,
        versionPublishedAt: m.versionPublishedAt,
        lessonIds: m.lessons.map((x) => x.id),
        completions: cBy.get(key) ?? [],
        questionCount: m._count.questions,
        attempts: aBy.get(key) ?? [],
        certificates: certBy.get(key) ?? [],
        isRequired: required,
        dueDays: m.dueDays,
        learnerSince: l.since,
        now,
      });
      const stats = moduleStats.get(m.id)!;
      if (m.audience === l.audience) {
        stats.learners++;
        if (st.certified) stats.certified++;
        if (st.overdue) stats.overdue++;
      }
      if (required) {
        requiredTotal++;
        if (st.certified) requiredCertified++;
        if (st.overdue) overdue++;
      }
      const latestCert = (certBy.get(key) ?? []).sort((a, b) => b.moduleVersion - a.moduleVersion)[0];
      cells[m.id] = {
        state: st.state,
        overdue: st.overdue,
        bestScorePct: st.bestScorePct ?? latestCert?.scorePct ?? null,
        certifiedAt: latestCert ? latestCert.issuedAt.toISOString() : null,
        certVersion: latestCert?.moduleVersion ?? null,
        attempts: (aBy.get(key) ?? []).filter((a) => a.moduleVersion === m.version).length,
        dueAt: st.dueAt?.toISOString() ?? null,
      };
    }
    return { userId: l.userId, name: l.name, phone: l.phone, audience: l.audience, restaurant: l.restaurant, requiredTotal, requiredCertified, overdue, cells };
  });

  const attemptsByModule = new Map<string, { n: number; passed: number; sum: number }>();
  for (const a of attempts) {
    const m = modules.find((x) => x.id === a.moduleId);
    if (!m || a.moduleVersion !== m.version) continue;
    const s = attemptsByModule.get(a.moduleId) ?? { n: 0, passed: 0, sum: 0 };
    s.n++;
    s.sum += a.scorePct;
    if (a.passed) s.passed++;
    attemptsByModule.set(a.moduleId, s);
  }

  return {
    generatedAt: now.toISOString(),
    modules: modules.map((m) => {
      const s = moduleStats.get(m.id)!;
      const a = attemptsByModule.get(m.id) ?? { n: 0, passed: 0, sum: 0 };
      return {
        id: m.id, title: m.title, audience: m.audience, isRequired: m.isRequired, isActive: m.isActive, version: m.version,
        learners: s.learners, certified: s.certified, overdue: s.overdue,
        attempts: a.n, passedAttempts: a.passed,
        passRatePct: a.n ? Math.round((a.passed / a.n) * 100) : null,
        avgScorePct: a.n ? Math.round(a.sum / a.n) : null,
      };
    }),
    learners: reportLearners,
  };
}

/** Quote a CSV field; neutralise spreadsheet formula injection. */
export function csvField(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const STATE_LABEL: Record<ReportCellState, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  QUIZ_READY: 'Quiz pending',
  CERTIFIED: 'Certified',
  RECERT_REQUIRED: 'Re-certification required',
  NOT_ASSIGNED: 'Not assigned',
};

export function stateLabel(s: ReportCellState): string {
  return STATE_LABEL[s];
}

/** One row per learner × assigned module. */
export function reportToCsv(report: TrainingReport): string {
  const header = [
    'Learner', 'Phone', 'Audience', 'Restaurant', 'Module', 'Module audience', 'Required', 'Current version',
    'Status', 'Overdue', 'Due date', 'Best score %', 'Attempts (current version)', 'Last certificate version', 'Last certified at',
  ];
  const lines = [header.map(csvField).join(',')];
  for (const l of report.learners) {
    for (const m of report.modules) {
      const c = l.cells[m.id];
      if (!c || c.state === 'NOT_ASSIGNED') continue;
      lines.push(
        [
          l.name, l.phone, l.audience, l.restaurant, m.title, m.audience,
          m.isRequired && m.audience === l.audience ? 'Yes' : 'No', m.version, stateLabel(c.state),
          c.overdue ? 'Yes' : 'No', c.dueAt?.slice(0, 10) ?? '', c.bestScorePct ?? '', c.attempts,
          c.certVersion ?? '', c.certifiedAt?.slice(0, 10) ?? '',
        ].map(csvField).join(','),
      );
    }
  }
  return lines.join('\r\n') + '\r\n';
}
