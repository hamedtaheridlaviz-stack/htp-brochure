// api/brochure.js
// Add this file to your project root /api/ folder
// Then add to vercel.json: { "rewrites": [{ "source": "/brochure", "destination": "/api/brochure" }] }

const fs = require('fs');
const path = require('path');

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = async (req, res) => {
  const pfUrl = req.query.url;

  // Read the static HTML file
  // Adjust path below if your brochure.html lives somewhere else
  const htmlPath = path.join(process.cwd(), 'public', 'brochure.html');
  let html = fs.existsSync(htmlPath)
    ? fs.readFileSync(htmlPath, 'utf8')
    : fs.readFileSync(path.join(process.cwd(), 'brochure.html'), 'utf8');

  if (pfUrl) {
    try {
      // Reuse your existing /api/scrape endpoint
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const host  = req.headers.host;
      const scrapeRes = await fetch(
        `${proto}://${host}/api/scrape?url=${encodeURIComponent(pfUrl)}`
      );
      const d = await scrapeRes.json();

      if (!d.error) {
        // Build dynamic values
        const title = [
          d.building,
          d.beds ? `${d.beds} BR` : null,
          d.price ? `AED ${d.price}` : null,
          'BetterHomes'
        ].filter(Boolean).join(' | ');

        const description = [
          d.marketingTitle || d.area,
          d.size ? `${d.size} sqft` : null,
          'Contact Hamed Taheri +971 58 517 1746'
        ].filter(Boolean).join(' · ');

        const image = (d.photos && d.photos[0]) ||
          'https://htp-brochure.vercel.app/bh_logo_tight_highres.png';

        const pageUrl = `https://${host}/brochure?url=${encodeURIComponent(pfUrl)}`;

        // Inject into <title>
        html = html.replace(
          /<title>[^<]*<\/title>/,
          `<title>${esc(title)}</title>`
        );

        // OG tags
        html = html
          .replace(/(<meta property="og:title"\s+content=")[^"]*(")/,
            `$1${esc(title)}$2`)
          .replace(/(<meta property="og:image"\s+content=")[^"]*(")/,
            `$1${esc(image)}$2`)
          .replace(/(<meta property="og:url"\s+content=")[^"]*(")/,
            `$1${esc(pageUrl)}$2`);

        // Add og:description if not present, else replace
        if (html.includes('og:description')) {
          html = html.replace(
            /(<meta property="og:description"\s+content=")[^"]*(")/,
            `$1${esc(description)}$2`
          );
        } else {
          html = html.replace(
            /<meta property="og:title"/,
            `<meta property="og:description" content="${esc(description)}">\n<meta property="og:title"`
          );
        }

        // Twitter card tags
        html = html
          .replace(/(<meta name="twitter:title"\s+content=")[^"]*(")/,
            `$1${esc(title)}$2`)
          .replace(/(<meta name="twitter:image"\s+content=")[^"]*(")/,
            `$1${esc(image)}$2`);

        // Add twitter:description if not present
        if (!html.includes('twitter:description')) {
          html = html.replace(
            /<meta name="twitter:card"/,
            `<meta name="twitter:description" content="${esc(description)}">\n<meta name="twitter:card"`
          );
        }
      }
    } catch (e) {
      console.error('OG injection error:', e.message);
      // Fall through — serve the static HTML unchanged
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
  res.end(html);
};
