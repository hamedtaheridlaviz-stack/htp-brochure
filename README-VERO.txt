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
