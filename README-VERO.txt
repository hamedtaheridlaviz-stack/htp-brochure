VERO BROCHURE V5 — MOBILE FIRST REDESIGN

Deploy the CONTENTS of this folder to the existing htp-brochure GitHub/Vercel project root.
Do not upload the ZIP itself to Vercel.

Main changes
- Rebuilt /brochure as a premium mobile-first Vero brochure matching the approved iPhone design direction.
- Clean white Vero header with responsive mobile menu.
- Full-width hero image with editorial typography and live Property Finder data.
- Premium price + Beds / Baths / Sq. Ft. cards.
- Mobile-friendly About This Home section.
- Swipeable 3-up gallery strip on iPhone; click/tap opens a full-screen lightbox.
- New Hamed Taheri profile image and Senior Private Client Advisor contact card.
- GET IN TOUCH opens WhatsApp with the brochure/property already referenced.
- Native mobile Share support with clipboard fallback.
- Save PDF now uses /api/pdf and the PDF route outputs A4 portrait to match the new editorial design.
- Replaced the old embedded/base64 Vero logo approach with /public/assets/vero-logo.png so the logo does not render as a black block.
- Added /public/assets/vero-og.jpg as a branded fallback social preview image.
- Updated WhatsApp/OG preview branding from old BetterHomes/Hamed Taheri Properties wording to Vero Real Estate.

Files replaced/updated
- public/brochure.html
- public/assets/vero-logo.png
- public/assets/hamed-taheri.jpg
- public/assets/vero-og.jpg (new)
- api/pdf.js
- api/brochure.js
- api/preview.js
- README-VERO.txt

Files intentionally preserved
- api/scrape.js
- package.json
- vercel.json

Existing live URL format remains unchanged:
https://htp-brochure.vercel.app/brochure?url=<PROPERTY_FINDER_URL>

PDF endpoint remains:
https://htp-brochure.vercel.app/api/pdf?url=<PROPERTY_FINDER_URL>
