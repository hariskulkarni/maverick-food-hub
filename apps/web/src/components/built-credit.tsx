/**
 * BuiltCredit — hardcoded "Designed & Built by Imaginariumx" attribution
 * shown at the bottom of every page.
 *
 *   • Mounted ONCE in the root layout (apps/web/src/app/layout.tsx) so it
 *     appears on every route — customer pages, /r/<slug> storefronts, /admin,
 *     /platform, /kitchen, /login, the lot.
 *   • Intentionally NOT CMS-editable: this credit is fixed and stays put
 *     regardless of what admins type into the Footer fields in
 *     /platform/discovery-cms.
 *   • On mobile customer routes the MobileBottomNav is `fixed bottom-0` and
 *     ~88px tall, so the credit gets bottom margin on mobile to clear it.
 *     Desktop has no fixed nav so the margin is removed at md.
 *   • Uses `safe-bottom` (defined in globals.css) so the credit clears the
 *     iOS home indicator on notched devices.
 *   • Low-key visual treatment — small + muted — so it never competes with
 *     the page's own footer or call-to-action.
 */
export function BuiltCredit() {
  return (
    <div
      role="contentinfo"
      aria-label="Site credit"
      className="
        w-full text-center text-[11px] text-muted-foreground
        py-2 px-4
        mb-[96px] md:mb-0
        safe-bottom
        border-t border-border/40 bg-background/60
      "
    >
      Designed &amp; Built by{' '}
      <a
        href="https://imaginariumx.ca"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-foreground hover:text-primary transition-colors underline-offset-2 hover:underline"
      >
        Imaginariumx
      </a>
    </div>
  );
}
