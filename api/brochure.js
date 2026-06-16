// api/brochure.js
// WhatsApp/bots → OG-tag HTML with rich preview
// Real browsers  → 302 redirect to static /brochure page
//
// Supports query params:
//   ?url=    PropertyFinder listing URL (required)
//   ?photo=  Direct image URL (optional, skips scraping)
//   ?title=  Property title override (optional)
//   ?beds=   Bedrooms (optional)
//   ?price=  Price (optional)

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = async (req, res) => {
  const pfUrl    = req.query.url;
  const photoParam = req.query.photo;
  const titleParam = req.query.title;
  const bedsParam  = req.query.beds;
  const priceParam = req.query.price;
  const ua         = req.headers['user-agent'] || '';

  const isBot = /whatsapp|facebookexternalhit|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|googlebot/i.test(ua);

  // Real human → redirect to static brochure page
  if (!isBot) {
    const dest = pfUrl ? `/brochure?url=${encodeURIComponent(pfUrl)}` : '/brochure';
    res.writeHead(302, { Location: dest });
    res.end();
    return;
  }

  // ── Bot: build OG tags ───────────────────────────────────────────────────
  const host    = req.headers.host;
  const proto   = req.headers['x-forwarded-proto'] || 'https';
  const redirect = pfUrl ? `/brochure?url=${encodeURIComponent(pfUrl)}` : '/brochure';
  const pageUrl  = `${proto}://${host}/api/brochure?url=${encodeURIComponent(pfUrl || '')}`;

  let title       = 'Hamed Taheri Properties – Dubai';
  let description = 'Luxury residential properties in Dubai. Contact Hamed Taheri +971 58 517 1746';
  let image       = `${proto}://${host}/bh_logo_tight_highres.png`;

  // If params passed directly — use them (fast, no scraping needed)
  if (titleParam || bedsParam || priceParam) {
    title = [
      titleParam,
      bedsParam  ? `${bedsParam} BR`    : null,
      priceParam ? `AED ${priceParam}`  : null,
      'Hamed Taheri Properties'
    ].filter(Boolean).join(' | ');

    description = [
      bedsParam  ? `${bedsParam} Bedroom` : null,
      priceParam ? `AED ${priceParam}`    : null,
      'Contact Hamed Taheri: +971 58 517 1746'
    ].filter(Boolean).join(' · ');
  }

  if (photoParam) {
    image = photoParam;
  } else if (pfUrl) {
    // Try scraping — but with a short timeout so WhatsApp doesn't give up
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000); // 4s timeout
      const r = await fetch(
        `${proto}://${host}/api/scrape?url=${encodeURIComponent(pfUrl)}`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);
      const d = await r.json();

      if (!d.error) {
        if (!titleParam) {
          title = [
            d.building,
            d.beds  ? `${d.beds} BR`   : null,
            d.price ? `AED ${d.price}` : null,
            'Hamed Taheri Properties'
          ].filter(Boolean).join(' | ');

          description = [
            d.marketingTitle || d.area || '',
            d.size ? `${d.size} sqft`   : null,
            'Contact: +971 58 517 1746'
          ].filter(Boolean).join(' · ');
        }
        if (d.photos && d.photos[0]) image = d.photos[0];
      }
    } catch (_) {
      // Timed out or failed — use logo fallback
    }
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<meta property="og:type"         content="website">
<meta property="og:title"        content="${esc(title)}">
<meta property="og:description"  content="${esc(description)}">
<meta property="og:image"        content="${esc(image)}">
<meta property="og:image:width"  content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url"          content="${esc(pageUrl)}">
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:title"       content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image"       content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=${esc(redirect)}">
</head>
<body><a href="${esc(redirect)}">${esc(title)}</a></body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.end(html);
};
