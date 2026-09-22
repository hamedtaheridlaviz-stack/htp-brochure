// api/brochure.js
// Rich social/WhatsApp preview endpoint for the normal /brochure URL.
//
// Humans: redirected to the static brochure app at /?url=...
// Bots: receive Open Graph HTML immediately.
//
// The brochure app enriches shared URLs with title + first photo so WhatsApp
// does not need to wait for Property Finder scraping before it can render.

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v) !== '') s.set(k, String(v));
  }
  return s.toString();
}

module.exports = async (req, res) => {
  const pfUrl      = req.query.url || '';
  const photoParam = req.query.photo || '';
  const titleParam = req.query.title || '';
  const previewVer = req.query.wa || '2';
  const ua         = req.headers['user-agent'] || '';

  // WhatsApp link previews are commonly fetched by facebookexternalhit.
  const isBot = /whatsapp|facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|googlebot|bingbot|pinterest/i.test(ua);

  // Human browser: keep using the existing static brochure app, preserving
  // enriched params so refresh/copy/share continues to use the rich URL.
  if (!isBot) {
    const destQuery = qs({ url: pfUrl, title: titleParam, photo: photoParam, wa: previewVer });
    const dest = destQuery ? `/?${destQuery}` : '/';
    res.writeHead(302, { Location: dest, 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  const host  = req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const origin = `${proto}://${host}`;

  let title = titleParam || 'Property Brochure';
  let photo = photoParam || '';

  // Old/plain brochure links have no title/photo params. Keep a best-effort
  // fallback scrape, but cap it so WhatsApp is not left waiting too long.
  if (pfUrl && (!titleParam || !photoParam)) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const r = await fetch(`${origin}/api/scrape?url=${encodeURIComponent(pfUrl)}`, {
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache' }
      });
      clearTimeout(timeout);
      if (r.ok) {
        const d = await r.json();
        if (!d.error) {
          if (!titleParam) {
            const building = String(d.building || '').trim();
            const area = String(d.area || '').trim();
            title = [
              building || null,
              area && area.toLowerCase() !== building.toLowerCase() ? area : null
            ].filter(Boolean).join(' | ') || 'Property Brochure';
          }
          if (!photoParam && d.photos && d.photos[0]) photo = d.photos[0];
        }
      }
    } catch (_) {}
  }

  const description = 'View brochure';
  const image = photo
    ? `${origin}/api/og-image?photo=${encodeURIComponent(photo)}&wa=${encodeURIComponent(previewVer)}`
    : `${origin}/assets/vero-og.jpg`;

  // Use the exact share URL as og:url, including the cache-busting version.
  const pageQuery = qs({ url: pfUrl, title: titleParam, photo: photoParam, wa: previewVer });
  const pageUrl = `${origin}/brochure${pageQuery ? `?${pageQuery}` : ''}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:secure_url" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
</head>
<body>
<a href="${esc(pfUrl ? `/?url=${encodeURIComponent(pfUrl)}` : '/')}">View brochure</a>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.statusCode = 200;
  res.end(html);
};
