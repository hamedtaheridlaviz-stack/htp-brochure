const https = require('https');
const http = require('http');

function fetchUrl(url, redirectCount) {
  redirectCount = redirectCount || 0;
  if (redirectCount > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function metaContent(html, name) {
  const pats = [
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'),
    new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${name}["']`, 'i'),
  ];
  for (const p of pats) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return '';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = async (req, res) => {
  const pfUrl = req.query && req.query.url;
  const brochureBase = 'https://htp-brochure.vercel.app';

  if (!pfUrl) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send('<h1>Missing ?url= parameter</h1>');
  }

  // The actual brochure URL the user lands on after clicking the preview card
  const brochureUrl = `${brochureBase}/brochure?url=${encodeURIComponent(pfUrl)}`;
  // The canonical preview URL (for og:url)
  const previewUrl = `${brochureBase}/preview?url=${encodeURIComponent(pfUrl)}`;

  let title = 'Property Brochure | Hamed Taheri Properties';
  let description = 'Presented by Hamed Taheri Dlaviz · Licensed Real Estate Broker · Dubai';
  let image = `${brochureBase}/og-default.png`;
  let price = '';
  let beds = '';
  let area = '';

  try {
    const html = await fetchUrl(pfUrl);

    // Extract property title / building
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleTag) {
      const raw = titleTag[1].replace(/\s*[\|\-–].*$/, '').trim();
      if (raw) title = raw + ' | Hamed Taheri Properties';
    }

    // og:image from PropertyFinder (first real photo)
    const ogImg = metaContent(html, 'og:image');
    if (ogImg && ogImg.startsWith('http')) image = ogImg;

    // og:description or description
    const ogDesc = metaContent(html, 'og:description') || metaContent(html, 'description');
    if (ogDesc) description = ogDesc;

    // Try __NEXT_DATA__ for structured data
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const nd = JSON.parse(nextMatch[1]);
        const props = nd?.props?.pageProps?.listing || nd?.props?.pageProps?.property || null;
        if (props) {
          beds = props.beds || props.bedrooms || '';
          area = props.area || props.size || '';
          if (props.price) {
            const p = Number(String(props.price).replace(/[^0-9]/g, ''));
            if (p > 0 && p < 1e9) price = 'AED ' + p.toLocaleString();
          }
          if (props.title) title = props.title + ' | Hamed Taheri Properties';
          if (props.photos && props.photos.length > 0) {
            const ph = props.photos[0];
            const src = ph.url || ph.src || ph;
            if (typeof src === 'string' && src.startsWith('http')) image = src;
          }
        }
      } catch (e) {}
    }

    // Build a smart description
    const parts = [];
    if (beds) parts.push(beds + ' Bed');
    if (area) parts.push(area + ' sqft');
    if (price) parts.push(price);
    if (parts.length > 0) {
      description = parts.join(' · ') + ' · Presented by Hamed Taheri Dlaviz, BetterHomes Dubai';
    }

  } catch (e) {
    // Fall through with defaults — still render the redirect page
  }

  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description);
  const safeImage = escapeHtml(image);
  const safeBrochureUrl = escapeHtml(brochureUrl);
  const safePreviewUrl = escapeHtml(previewUrl);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Cache for 1 hour so repeated shares are fast, but refreshes after listing changes
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>

  <!-- Standard meta -->
  <meta name="description" content="${safeDesc}">

  <!-- Open Graph (Facebook, WhatsApp, LinkedIn, iMessage, Telegram…) -->
  <meta property="og:type"        content="website">
  <meta property="og:url"         content="${safePreviewUrl}">
  <meta property="og:title"       content="${safeTitle}">
  <meta property="og:description" content="${safeDesc}">
  <meta property="og:image"       content="${safeImage}">
  <meta property="og:image:width"  content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name"   content="Hamed Taheri Properties">

  <!-- Twitter Card -->
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="${safeTitle}">
  <meta name="twitter:description" content="${safeDesc}">
  <meta name="twitter:image"       content="${safeImage}">

  <!-- Instant redirect for humans — bots (WhatsApp, etc.) stop at meta tags and don't follow -->
  <meta http-equiv="refresh" content="0; url=${safeBrochureUrl}">

  <style>
    body { margin: 0; font-family: -apple-system, sans-serif; background: #f5f0e8;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: white; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,.12);
            max-width: 420px; width: 90%; overflow: hidden; text-align: center; }
    .card img { width: 100%; height: 220px; object-fit: cover; display: block; }
    .card-body { padding: 24px; }
    h1 { font-size: 17px; color: #1a4a3a; margin: 0 0 8px; line-height: 1.3; }
    p  { font-size: 13px; color: #666; margin: 0 0 20px; }
    a  { display: inline-block; background: #1a4a3a; color: white; padding: 12px 28px;
         border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 600;
         letter-spacing: 1px; }
  </style>
</head>
<body>
  <div class="card">
    <img src="${safeImage}" alt="Property photo" onerror="this.style.display='none'">
    <div class="card-body">
      <h1>${safeTitle}</h1>
      <p>${safeDesc}</p>
      <a href="${safeBrochureUrl}">VIEW BROCHURE</a>
    </div>
  </div>
</body>
</html>`);
};
