/** Shared bits for the /api/platform/help/* authoring routes (SUPER_ADMIN only). */
import type { Session } from 'next-auth';
import type { HelpArticle } from '@prisma/client';
import type { Actor } from '@/server/help/authoring';

export function actorOf(session: Session): Actor {
  return { id: session.user.id, name: session.user.name ?? session.user.email ?? null, role: session.user.role };
}

/** Article DTO for the authoring console (full content, no search vector). */
export function articleDto(a: HelpArticle) {
  return {
    id: a.id,
    slug: a.slug,
    language: a.language,
    title: a.title,
    summary: a.summary,
    body: a.body,
    audience: a.audience,
    tags: a.tags,
    status: a.status,
    appArea: a.appArea,
    relatedSlugs: a.relatedSlugs,
    sortOrder: a.sortOrder,
    version: a.version,
    viewCount: a.viewCount,
    categoryId: a.categoryId,
    publishedAt: a.publishedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}
