const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// HTTP/HTTPS GET helper — avoids needing node-fetch
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse failed: ' + data.slice(0, 100))); }
      });
    }).on('error', reject);
  });
}

module.exports = async (req, res) => {
  const pfUrl = req.query.url;

  // Read the HTML file from public/
  const htmlPath = path.join(process.cwd(), 'public', 'brochure.html');
  let html;
  try {
    html = fs.readFileSync(htmlPath, 'utf8');
  } catch (e) {
    res.status(500).send('Could not read brochure.html: ' + e.message);
    return;
  }

  if (pfUrl) {
    try {
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const host  = req.headers.host;
      const scrapeUrl = `${proto}://${host}/api/scrape?url=${encodeURIComponent(pfUrl)}`;

      const d = await httpGet(scrapeUrl);

      if (!d.error) {
        const title = [
          d.building,
          d.beds ? `${d.beds} BR` : null,
          d.price ? `AED ${d.price}` : null,
          'Hamed Taheri Properties'
        ].filter(Boolean).join(' | ');

        const description = [
          d.marketingTitle || d.area || '',
          d.size ? `${d.size} sqft` : null,
          'Contact Hamed Taheri +971 58 517 1746'
        ].filter(Boolean).join(' · ');

        const image = (d.photos && d.photos[0])
          ? d.photos[0]
          : `https://${host}/bh_logo_tight_highres.png`;

        const pageUrl = `https://${host}/brochure?url=${encodeURIComponent(pfUrl)}`;

        // Update <title>
        html = html.replace(
          /<title>[^<]*<\/title>/i,
          `<title>${esc(title)}</title>`
        );

        // Update og:description (add if missing)
        if (html.includes('og:description')) {
          html = html.replace(
            /(<meta\s+property="og:description"\s+content=")[^"]*(")/i,
            `$1${esc(description)}$2`
          );
        } else {
          html = html.replace(
            /(<meta\s+property="og:title")/i,
            `<meta property="og:description" content="${esc(description)}">\n<meta property="og:title"`
          );
        }

        // Update og:title
        html = html.replace(
          /(<meta\s+property="og:title"\s+content=")[^"]*(")/i,
          `$1${esc(title)}$2`
        );

        // Update og:image
        html = html.replace(
          /(<meta\s+property="og:image"\s+content=")[^"]*(")/i,
          `$1${esc(image)}$2`
        );

        // Update og:url
        if (html.includes('og:url')) {
          html = html.replace(
            /(<meta\s+property="og:url"\s+content=")[^"]*(")/i,
            `$1${esc(pageUrl)}$2`
          );
        }

        // Update twitter tags
        html = html
          .replace(
            /(<meta\s+name="twitter:title"\s+content=")[^"]*(")/i,
            `$1${esc(title)}$2`
          )
          .replace(
            /(<meta\s+name="twitter:image"\s+content=")[^"]*(")/i,
            `$1${esc(image)}$2`
          );
      }
    } catch (e) {
      console.error('OG injection error:', e.message);
      // Fall through — serve static HTML unchanged
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  res.end(html);
};
