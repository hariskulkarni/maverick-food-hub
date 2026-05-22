/**
 * Renders a JSON-LD <script> for structured data (schema.org).
 *
 * Server-friendly: emits a single <script type="application/ld+json"> with the
 * serialized payload. Used to feed Organization / WebSite / Restaurant /
 * BreadcrumbList graphs to search engines and AI crawlers without touching the
 * surrounding page markup.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe to inline; <script> is not HTML-parsed.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export default JsonLd;
