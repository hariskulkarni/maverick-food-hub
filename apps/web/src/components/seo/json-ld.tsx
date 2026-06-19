/**
 * Renders a JSON-LD <script> for structured data (schema.org).
 *
 * Server-friendly: emits a single <script type="application/ld+json"> with the
 * serialized payload. Used to feed Organization / WebSite / Restaurant /
 * BreadcrumbList graphs to search engines and AI crawlers without touching the
 * surrounding page markup.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  // JSON.stringify does NOT escape `<`, so a field containing `</script>` (e.g.
  // a user-supplied restaurant name or review) would break out of the script
  // tag → stored XSS. Escape `<` plus the U+2028/U+2029 line separators that
  // are valid in JSON but not in JS string literals.
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}

export default JsonLd;
