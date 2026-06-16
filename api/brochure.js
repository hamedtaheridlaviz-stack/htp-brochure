const https = require('https');
const http  = require('http');

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse failed')); }
      });
    }).on('error', reject);
  });
}

module.exports = async (req, res) => {
  const pfUrl = req.query.url;
  const ua    = req.headers['user-agent'] || '';

  // Detect WhatsApp / social media crawlers
  const isBot = /whatsapp|facebookexternalhit|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|googlebot/i.test(ua);

  // If real human — redirect to the static brochure page
  if (!isBot) {
    const dest = pfUrl
      ? `/brochure?url=${encodeURIComponent(pfUrl)}`
      : '/brochure';
    res.writeHead(302, { Location: dest });
    res.end();
    return;
  }

  // ── Bot path: build OG-tag HTML ──────────────────────────────────────────
  let title       = 'Hamed Taheri Properties – Dubai';
  let description = 'Luxury residential properties in Dubai. Contact Hamed Taheri +971 58 517 1746';
  let image       = `https://${req.headers.host}/bh_logo_tight_highres.png`;
  const pageUrl   = pfUrl
    ? `https://${req.headers.host}/api/brochure?url=${encodeURIComponent(pfUrl)}`
    : `https://${req.headers.host}/brochure`;
  const redirect  = pfUrl
    ? `/brochure?url=${encodeURIComponent(pfUrl)}`
    : '/brochure';

  if (pfUrl) {
    try {
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const host  = req.headers.host;
      const d = await httpGet(`${proto}://${host}/api/scrape?url=${encodeURIComponent(pfUrl)}`);

      if (!d.error) {
        title = [
          d.building,
          d.beds ? `${d.beds} BR` : null,
          d.price ? `AED ${d.price}` : null,
          'Hamed Taheri Properties'
        ].filter(Boolean).join(' | ');

        description = [
          d.marketingTitle || d.area || '',
          d.size ? `${d.size} sqft` : null,
          'Contact: +971 58 517 1746'
        ].filter(Boolean).join(' · ');

        if (d.photos && d.photos[0]) image = d.photos[0];
      }
    } catch (e) {
      // Use defaults if scrape fails
    }
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<meta property="og:type"        content="website">
<meta property="og:title"       content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image"       content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url"         content="${esc(pageUrl)}">
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:title"       content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image"       content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=${esc(redirect)}">
</head>
<body>
<a href="${esc(redirect)}">${esc(title)}</a>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.end(html);
};
