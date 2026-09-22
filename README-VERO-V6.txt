VERO BROCHURE V6 — 22 SEP 2026

CHANGES IN THIS UPDATE
1. Main brochure heading now uses property address/building + area, e.g.:
   Al Anbara | Palm Jumeirah
   instead of "Private Property Brochure".
2. Property description is rebranded with:
   "Vero is proud to present this residence at [property address]."
   The source agency's standard intro sentence is stripped where detected.
3. Removed "Distinctive homes / considered service / private guidance".
4. Removed "More than a home / a considered lifestyle".
5. Removed footer "Dubai | London | Global".
6. Removed "Prepared [date]" from property meta line. It now reads only e.g.:
   Apartment · For Sale
7. Removed bottom-right "VERO / REAL ESTATE" text from the main hero image.
8. Added a centred off-white Vero wordmark watermark to the hero image, matched to the header logo sizing.
9. PDF output inherits the same updated brochure because api/pdf.js renders the live /brochure page.
10. Social/share fallback wording updated from "Vero Private Property Brochure" to "Vero Property Brochure".

FILES TO REPLACE ON GITHUB FOR THE COMPLETE UPDATE
- public/brochure.html
- public/assets/vero-watermark.png   [NEW FILE]
- api/brochure.js
- api/preview.js

NO NEED TO REPLACE
- public/assets/vero-logo.png
- public/assets/hamed-taheri.jpg
- api/scrape.js
- api/pdf.js
- package.json
- vercel.json

Your existing Vero logo and Hamed profile image are already retained in this package.
