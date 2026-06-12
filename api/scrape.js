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

module.exports = async (req, res) => {
  const url = req.query && req.query.url;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  try {
    const html = await fetchUrl(url);

    // ── JSON-LD ──
    let jsonLD = null;
    const jsonLDMatches = Array.from(html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi));
    for (const match of jsonLDMatches) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.name || parsed['@type']) { jsonLD = parsed; break; }
      } catch(e) {}
    }

    // ── __NEXT_DATA__ (Next.js serialised store) ──
    let nextStr = '';
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        JSON.parse(nextMatch[1]); // validate
        nextStr = nextMatch[1];
      } catch(e) {}
    }

    const metaContent = (name) => {
      const pats = [
        new RegExp('<meta[^>]*name="' + name + '"[^>]*content="([^"]*)"', 'i'),
        new RegExp('<meta[^>]*content="([^"]*)"[^>]*name="' + name + '"', 'i'),
        new RegExp('<meta[^>]*property="' + name + '"[^>]*content="([^"]*)"', 'i'),
        new RegExp('<meta[^>]*content="([^"]*)"[^>]*property="' + name + '"', 'i'),
      ];
      for (const p of pats) { const m = html.match(p); if (m) return m[1]; }
      return '';
    };

    const cleanHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    const text = cleanHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // ── Building name ──
    let building = (jsonLD && jsonLD.name) || metaContent('og:title') || '';
    building = building.replace(/\s*[\|\-]\s*(?:Property\s*Finder|PropertyFinder|Bayut|betterhomes)[\s\S]*/i, '').trim();
    building = building.replace(/^(?:Sale|Rent|Buy)\s+in\s+/i, '').trim();
    building = building.split('|')[0].split(':')[0].trim();

    // ── Marketing title (listing headline e.g. "New To Market | C Type | Fully Renovated") ──
    let marketingTitle = '';
    // h1 elements — skip ones that match building name or contain "Property Finder"
    const h1s = Array.from(html.matchAll(/<h1[^>]*>([^<]{10,150})<\/h1>/gi));
    for (const m of h1s) {
      const t = m[1].trim();
      if (t.toLowerCase().includes('property finder')) continue;
      if (t === building) continue;
      marketingTitle = t;
      break;
    }
    // Fallback: __NEXT_DATA__ title field
    if (!marketingTitle && nextStr) {
      const m = nextStr.match(/"title"\s*:\s*"([^"]{10,150})"/);
      if (m && !m[1].includes('Property Finder')) marketingTitle = m[1];
    }

    // ── Area ──
    let area = '';
    if (jsonLD && jsonLD.address) area = jsonLD.address.addressLocality || jsonLD.address.addressRegion || '';
    if (!area) {
      const ogTitle = metaContent('og:title') || '';
      const m = ogTitle.match(/in\s+([\w\s]+(?:,\s*[\w\s]+)?)\s*[\|:]/i);
      if (m) area = m[1].trim();
    }
    if (!area) area = 'Dubai';

    // ── REF ──
    let ref = '';
    const urlRefM = url.match(/-(\d{6,})\.html/);
    if (urlRefM) ref = urlRefM[1];
    if (!ref) {
      const refM = text.match(/(?:Reference|Ref(?:erence)?\s*(?:No\.?|Number|#|:))\s*([A-Z0-9\-]{4,20})/i);
      if (refM) ref = refM[1];
    }

    // ── Beds / Baths / Size ──
    let beds = '', baths = '', size = '';
    if (jsonLD) {
      beds  = String(jsonLD.numberOfRooms || jsonLD.numberOfBedrooms || '');
      baths = String(jsonLD.numberOfBathroomsTotal || jsonLD.numberOfBathrooms || '');
      if (jsonLD.floorSize) size = String(jsonLD.floorSize.value || '');
    }
    if (!beds)  { const m = text.match(/(\d+)\s*Bed(?:room)?s?\b/i);  if (m) beds  = m[1]; }
    if (!baths) { const m = text.match(/(\d+)\s*Bath(?:room)?s?\b/i); if (m) baths = m[1]; }
    if (!size)  { const m = text.match(/([\d,]+)\s*sq\.?\s*(?:ft|feet)/i); if (m) size = m[1].replace(/,/g,''); }

    // ── Price ──
    // Strategy: __NEXT_DATA__ has real price as integer; 200,000,000 is a fake/default
    let price = '';

    // Method 1: __NEXT_DATA__ — find price integer in valid range
    if (nextStr) {
      const pricePatterns = [
        /"price"\s*:\s*\{\s*"value"\s*:\s*(\d+)/,
        /"asking_price"\s*:\s*(\d+)/,
        /"listingPrice"\s*:\s*(\d+)/,
        /"price"\s*:\s*(\d{5,9})[,\}]/,
      ];
      for (const pat of pricePatterns) {
        const m = nextStr.match(pat);
        if (m) {
          const raw = Number(m[1]);
          if (raw >= 100000 && raw <= 100000000) { price = 'AED ' + raw.toLocaleString(); break; }
        }
      }
    }

    // Method 2: og:description — usually contains "AED 5,790,000"
    if (!price) {
      const ogDesc = metaContent('og:description') || '';
      const m = ogDesc.match(/AED\s*([\d,]+)/i);
      if (m) {
        const raw = Number(m[1].replace(/,/g,''));
        if (raw >= 100000 && raw <= 100000000) price = 'AED ' + raw.toLocaleString();
      }
    }

    // Method 3: any inline script containing price integer (not 200000000)
    if (!price) {
      const scriptBlocks = Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi));
      for (const sb of scriptBlocks) {
        const s = sb[1];
        if (!s.includes('price') && !s.includes('Price')) continue;
        const m = s.match(/"price"\s*:\s*(\d{6,9})/);
        if (m) {
          const raw = Number(m[1]);
          if (raw >= 100000 && raw <= 100000000) { price = 'AED ' + raw.toLocaleString(); break; }
        }
      }
    }

    // Method 4: text scan capped at 100M
    if (!price) {
      const candidates = [];
      const allM = Array.from(text.matchAll(/AED\s*([\d,]+)/gi));
      for (const m of allM) {
        const raw = Number(m[1].replace(/,/g,''));
        if (raw >= 100000 && raw <= 100000000) candidates.push(raw);
      }
      if (candidates.length > 0) {
        const freq = {};
        candidates.forEach(v => freq[v] = (freq[v]||0)+1);
        const sorted = Object.entries(freq).sort((a,b) => b[1]-a[1] || Number(a[0])-Number(b[0]));
        price = 'AED ' + Number(sorted[0][0]).toLocaleString();
      }
    }

    let tenure = '';
    if (text.toLowerCase().includes('freehold')) tenure = 'Freehold';
    else if (text.toLowerCase().includes('leasehold')) tenure = 'Leasehold';

    // ── Description — always fixed Hamed text ──
    const description = "Betterhomes is proud to introduce this distinguished residence, set within one of Dubai's most prestigious residential destinations. Thoughtfully curated and impeccably presented, it offers a lifestyle defined by sophistication, privacy, and enduring appeal.\n\nFor further information or to arrange a private viewing, please contact Hamed Taheri Dlaviz.";

    // ── Features ──
    const features = [];
    if (beds)   features.push(beds + ' Bedroom' + (parseInt(beds) > 1 ? 's' : ''));
    if (baths)  features.push(baths + ' Bathroom' + (parseInt(baths) > 1 ? 's' : ''));
    if (size)   features.push(size + ' sq ft');
    if (tenure) features.push(tenure);

    // ── Photos ──
    const photos = [];
    const seen = new Set();
    const ogImage = metaContent('og:image');
    if (ogImage && ogImage.startsWith('http') && !ogImage.includes('floorplan')) {
      photos.push(ogImage); seen.add(ogImage);
    }
    // PF CDN listing images
    const pfImgs = Array.from(html.matchAll(/https:\/\/static\.shared\.propertyfinder\.ae\/media\/images\/listing\/[A-Za-z0-9]+\/[^"'\s\\]+\.jpg/g));
    for (const m of pfImgs) {
      const src = m[0];
      if (!seen.has(src) && !src.includes('floorplan') && photos.length < 5) {
        photos.push(src); seen.add(src);
      }
    }
    if (jsonLD && jsonLD.image) {
      const imgs = Array.isArray(jsonLD.image) ? jsonLD.image : [jsonLD.image];
      imgs.forEach(img => {
        const src = typeof img === 'string' ? img : (img.url || img.contentUrl || '');
        if (src && src.startsWith('http') && !src.includes('floorplan') && !seen.has(src) && photos.length < 5) {
          photos.push(src); seen.add(src);
        }
      });
    }

    // ── Floor plan ──
    let floorplan = '';
    const fpM = html.match(/https:\/\/static\.shared\.propertyfinder\.ae\/media\/images\/f[^"'\s\\]+(?:\.jpg|\.png|\.webp)/i);
    if (fpM) floorplan = fpM[0];
    if (!floorplan) {
      const fpM2 = html.match(/https:\/\/[^"'\s]+floorplan[^"'\s]+(?:\.jpg|\.png|\.webp)/i);
      if (fpM2) floorplan = fpM2[0];
    }

    return res.status(200).json({ building, area, ref, beds, baths, size, price, tenure, description, features, photos, floorplan, marketingTitle });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
