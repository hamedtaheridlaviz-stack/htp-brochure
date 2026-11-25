VERO BROCHURE V7 — 25 NOV 2026 · iPhone layout

- public/brochure.html: the approved Vero phone brochure (cover photo, "Prepared for <client>", title, rent/price,
  beds/baths/size/type, gallery with full-screen swipe viewer, About + features, black "Speak with your agent" page
  with WhatsApp / Book a private viewing / Save as PDF, pinned See photos / Book a viewing bar). Fustat font + Vero logos.
- Links unchanged: /brochure?url=<Property Finder link>. Add &for=<Client name> for "Prepared for" on the cover
  (api/brochure.js now passes it through the redirect).
- Data still from /api/scrape; WhatsApp previews and /api/pdf unchanged.
- New assets: fustat-300.woff2, fustat-400.woff2, vero-logo-dark.png, vero-logo-light.png, hamed-taheri-portrait.jpg
- Previous page: git history of public/brochure.html (V6, 22 Sep 2026).
