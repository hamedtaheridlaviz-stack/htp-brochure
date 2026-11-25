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

// Building / area straight from the Property Finder link (instant; the full read can take 10+ s and WhatsApp
// gives up long before that). e.g. ...-sale-dubai-palm-jumeirah-marina-residences-marina-residences-3-139204106.html
const AREAS = ['palm-jumeirah','dubai-marina','jumeirah-beach-residence','downtown-dubai','business-bay','dubai-hills-estate',
  'jumeirah-islands','emirates-hills','the-wilds','tilal-al-ghaf','jumeirah-lake-towers','bluewaters-island','dubai-harbour',
  'arabian-ranches','jumeirah-golf-estates','district-one','mohammed-bin-rashid-city','meydan-city','al-barari','city-walk',
  'jumeirah-village-circle','dubai-creek-harbour','the-palm-jumeirah','port-de-la-mer','la-mer','jumeirah'];
function cap(s) { return s.split('-').filter(Boolean).map(w => /^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' '); }
function fromSlug(u) {
  const m = String(u || '').match(/\/plp\/[^/]+\/[a-z-]+?-for-(?:sale|rent)-dubai-(.+?)-[A-Za-z0-9]{6,}\.html/);
  if (!m) return null;
  let rest = m[1], area = '';
  for (const a of AREAS) { if (rest === a || rest.startsWith(a + '-')) { area = a; rest = rest.slice(a.length + 1); break; } }
  const w = rest.split('-').filter(Boolean);
  const j = w.indexOf(w[0], 1);              // "marina residences marina residences 3" -> "marina residences 3"
  const bld = cap((j > 0 ? w.slice(j) : w).join('-'));
  return { building: bld, area: cap(area), rent: /\/rent\//.test(u) };
}
function short(v) {
  const n = parseFloat(String(v || '').replace(/[^0-9.]/g, ''));
  if (!n) return '';
  return n >= 1e6 ? 'AED ' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : 'AED ' + Math.round(n / 1e3) + 'K';
}

module.exports = async (req, res) => {
  // Short links (25 Nov 2026): /r/<PF id>/<building-slug>[/<client-slug>] (rent) or /b/... (sale).
  // Property Finder resolves a listing by its id whatever the slug, so the long ?url= link is no longer needed.
  const sid = /^\d{6,}$/.test(String(req.query.id || '')) ? String(req.query.id) : '';
  const sRent = req.query.k === 'r';
  if (sid) {
    req.query.url = `https://www.propertyfinder.ae/en/plp/${sRent ? 'rent' : 'buy'}/x-${sid}.html`;
    if (req.query.n && !req.query.for) req.query.for = cap(String(req.query.n).toLowerCase().replace(/[^a-z0-9-]/g, ''));
  }
  const sTitle = sid && req.query.t && req.query.t !== 'home' ? cap(String(req.query.t).toLowerCase().replace(/[^a-z0-9-]/g, '')) : '';
  const pfUrl    = req.query.url;
  const photoParam = req.query.photo;
  const titleParam = req.query.title;
  const bedsParam  = req.query.beds;
  const priceParam = req.query.price;
  const ua         = req.headers['user-agent'] || '';

  const isBot = /whatsapp|facebookexternalhit|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|googlebot/i.test(ua);

  // Real human → redirect to static brochure page
  if (!isBot) {
    const forName = req.query.for ? `&for=${encodeURIComponent(req.query.for)}` : '';  // client name for "Prepared for"
    const dest = pfUrl ? `/?url=${encodeURIComponent(pfUrl)}${forName}` : '/';
    res.writeHead(302, { Location: dest });
    res.end();
    return;
  }

  // ── Bot: build OG tags ───────────────────────────────────────────────────
  const host    = req.headers.host;
  const proto   = req.headers['x-forwarded-proto'] || 'https';
  const redirect = pfUrl ? `/?url=${encodeURIComponent(pfUrl)}${req.query.for ? '&for=' + encodeURIComponent(req.query.for) : ''}` : '/';
  const pageUrl  = sid ? `${proto}://${host}/${sRent ? 'r' : 'b'}/${sid}${req.query.t ? '/' + encodeURIComponent(req.query.t) : ''}${req.query.n ? '/' + encodeURIComponent(req.query.n) : ''}` : `${proto}://${host}/brochure?url=${encodeURIComponent(pfUrl || '')}`;

  // Compact black preview (25 Nov 2026): small square Vero tile -> WhatsApp shows a slim card with a thumbnail,
  // title = building | area, line 2 = price · beds · size (· Prepared for <name>).
  const slug = fromSlug(pfUrl) || (sid ? { building: sTitle, area: '', rent: sRent } : null);
  let title       = slug && slug.building ? [slug.building, slug.area && slug.area !== slug.building ? slug.area : ''].filter(Boolean).join(' | ') : 'Vero · Private brochure';
  let description = 'Private brochure · Vero';
  // Slim black strip (25 Nov 2026, option D): wide and short, small Vero mark
  let image       = `${proto}://${host}/assets/vero-og-strip.jpg`;
  let imgW = 1200, imgH = 360;
  const sizeParam = req.query.size;
  const facts = (p, b, z, rent) => [short(p) ? short(p) + (rent ? ' /yr' : '') : '', b ? (/^(0|studio)$/i.test(String(b)) ? 'Studio' : b + ' bed') : '',
    z ? Math.round(parseFloat(String(z).replace(/[^0-9.]/g, ''))).toLocaleString('en-US') + ' sqft' : ''].filter(Boolean).join(' · ');
  if (priceParam || bedsParam || sizeParam) description = facts(priceParam, bedsParam, sizeParam, slug && slug.rent) || description;

  // If params passed directly — use them (fast, no scraping needed)
  if (titleParam) {
    title = titleParam;
  }

  if (photoParam) {
    image = photoParam; imgW = 1200; imgH = 630;
  } else if (pfUrl && !(priceParam && titleParam)) {
    // Try scraping — but with a short timeout so WhatsApp doesn't give up
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500); // WhatsApp waits ~5 s
      const r = await fetch(
        `${proto}://${host}/api/scrape?url=${encodeURIComponent(pfUrl)}`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);
      const d = await r.json();

      if (!d.error) {
        if (!titleParam) {
          const building = String(sTitle || d.building || '').trim();
          const area = String(d.area || '').trim();
          title = [
            building || null,
            area && area.toLowerCase() !== building.toLowerCase() ? area : null
          ].filter(Boolean).join(' | ') || 'Property Brochure';
        }
        const f = facts(d.price, d.beds, d.size, slug && slug.rent);
        if (f && !priceParam) description = f;
      }
    } catch (_) {
      // Timed out or failed — use logo fallback
    }
  }

  if (req.query.for) description += ' · Prepared for ' + String(req.query.for).slice(0, 40);

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<meta property="og:type"         content="website">
<meta property="og:title"        content="${esc(title)}">
<meta property="og:description"  content="${esc(description)}">
<meta property="og:image"        content="${esc(image)}">
<meta property="og:image:width"  content="${imgW}">
<meta property="og:image:height" content="${imgH}">
<meta property="og:url"          content="${esc(pageUrl)}">
<meta name="twitter:card"        content="${imgW === imgH ? 'summary' : 'summary_large_image'}">
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
