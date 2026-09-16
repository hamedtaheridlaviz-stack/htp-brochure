VERO BROCHURE V2

Deploy this folder to the existing htp-brochure Vercel project / GitHub repo.

Changes:
- /brochure now uses the six-page Vero template (A4 landscape).
- Vero logo and Hamed Taheri contact page are fixed branding assets.
- Property Finder photos/details populate dynamically.
- Scraper now captures up to 20 listing photos and the listing description.
- /api/pdf?url=<PF_URL>&filename=<NAME> returns a downloadable PDF.
- CRM V4.2 uses that endpoint for one-click PDF download.

After deployment the existing domain can remain:
https://htp-brochure.vercel.app

V3: Vero logo and Hamed profile are embedded in the brochure HTML and also deployed as static assets. Footer spacing matches the supplied 6-page Vero PDF template.

V4 EXACT TEMPLATE
- Matches the supplied Vero 6-page PDF layout.
- Vero logo and Hamed portrait are embedded in brochure.html AND retained under public/assets, so Puppeteer PDF downloads cannot lose them.
- Footer/contact spacing is compact to match the supplied Vero reference.
- PDF route: /api/pdf?url=<PROPERTY_FINDER_URL>
- IMPORTANT: extract this ZIP and upload the api/, public/, package.json and vercel.json contents to the repository root. Do not upload the ZIP itself as the deployment.
