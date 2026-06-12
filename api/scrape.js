const https = require('https');
const http = require('http');

function fetchUrl(url, redirectCount = 0) {
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
    const jsonLDMatches = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const match of jsonLDMatches) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.name || parsed['@type']) { jsonLD = parsed; break; }
      } catch(e) {}
    }

    const metaContent = (name) => {
      const patterns = [
        new RegExp(`<meta[^>]*name="${name}"[^>]*content="([^"]*)"`, 'i'),
        new RegExp(`<meta[^>]*content="([^"]*)"[^>]*name="${name}"`, 'i'),
        new RegExp(`<meta[^>]*property="${name}"[^>]*content="([^"]*)"`, 'i'),
        new RegExp(`<meta[^>]*content="([^"]*)"[^>]*property="${name}"`, 'i'),
      ];
      for (const p of patterns) { const m = html.match(p); if (m) return m[1]; }
      return '';
    };

    const cleanHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    const text = cleanHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // ── Building — strip ALL marketing text ──
    let building = (jsonLD && jsonLD.name) || metaContent('og:title') || '';
    building = building.replace(/\s*[\|\-]\s*(?:Property\s*Finder|PropertyFinder|Bayut|betterhomes)[^]*/i, '').trim();
    building = building.replace(/^(?:Sale|Rent|Buy)\s+in\s+/i, '').trim();
    building = building.split('|')[0].split(':')[0].trim();

    // ── Marketing title — PF puts it in h1 inside description section ──
    let marketingTitle = '';
    // From inspect: <h1 class="styles_desktop_title__j0uNx">New To Market | C Type | Fully Renovated Unit</h1>
    // Also try __NEXT_DATA__ for the title field
    const h1Matches = [...html.matchAll(/<h1[^>]*>([^<]{10,150})<\/h1>/gi)];
    for (const m of h1Matches) {
      const t = m[1].trim();
      // Skip if it looks like a page title or contains "Property Finder"
      if (t.toLowerCase().includes('property finder') || t.toLowerCase().includes('propertyfinder')) continue;
      // Skip if it's just the building name
      if (t === building) continue;
      // Good candidate — likely the marketing title
      marketingTitle = t.replace(/\s*[|\-]\s*Property\s*Finder.*/i, '').trim();
      break;
    }
    // Fallback: try __NEXT_DATA__ for title/name fields
    if (!marketingTitle && nextDataMatch) {
      try {
        const str = JSON.parse(nextDataMatch[1]);
        const s = JSON.stringify(str);
        const m = s.match(/"title"\s*:\s*"([^"]{10,150})"/);
        if (m && !m[1].includes('Property Finder')) marketingTitle = m[1];
      } catch(e) {}
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

    // ── REF from URL ──
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

    // ── Price — validate 100k to 500M AED ──
    let price = '', tenure = '';

    // ── Price — PropertyFinder embeds price in __NEXT_DATA__ JSON script ──
    let price = '', tenure = '';

    // Method 1: __NEXT_DATA__ — PF is a Next.js app, price is in the serialised store
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        // Traverse to find price — it's nested deep in props.pageProps
        const str = JSON.stringify(nextData);
        // Look for "price":{"value":5790000 or "listingPrice":5790000
        const pricePatterns = [
          /"price"\s*:\s*\{\s*"value"\s*:\s*(\d+)/,
          /"listingPrice"\s*:\s*(\d+)/,
          /"asking_price"\s*:\s*(\d+)/,
          /"price"\s*:\s*(\d{5,9})[,\}]/,
        ];
        for (const pat of pricePatterns) {
          const m = str.match(pat);
          if (m) {
            const raw = Number(m[1]);
            if (raw >= 100000 && raw <= 500000000) {
              price = 'AED ' + raw.toLocaleString();
              break;
            }
          }
        }
      } catch(e) {}
    }

    // Method 2: Look for price in other inline JSON/script blocks
    if (!price) {
      const scriptMatches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
      for (const sm of scriptMatches) {
        const s = sm[1];
        if (!s.includes('price') && !s.includes('Price')) continue;
        const patterns = [
          /"price"\s*:\s*(\d{6,9})/,
          /"asking_price"\s*:\s*(\d{6,9})/,
          /"listingPrice"\s*:\s*(\d{6,9})/,
          /price["\s:]+(\d{6,9})/i,
        ];
        for (const pat of patterns) {
          const m = s.match(pat);
          if (m) {
            const raw = Number(m[1]);
            if (raw >= 100000 && raw <= 500000000) {
              price = 'AED ' + raw.toLocaleString();
              break;
            }
          }
        }
        if (price) break;
      }
    }

    // Method 3: og:description — "AED 5,790,000" appears here
    if (!price) {
      const ogDesc = metaContent('og:description') || '';
      const m = ogDesc.match(/AED\s*([\d,]+)/i);
      if (m) {
        const raw = Number(m[1].replace(/,/g,''));
        if (raw >= 100000 && raw <= 500000000) price = 'AED ' + raw.toLocaleString();
      }
    }

    // Method 4: page title sometimes has price
    if (!price) {
      const ogTitle = metaContent('og:title') || '';
      const m = ogTitle.match(/AED\s*([\d,]+)/i);
      if (m) {
        const raw = Number(m[1].replace(/,/g,''));
        if (raw >= 100000 && raw <= 500000000) price = 'AED ' + raw.toLocaleString();
      }
    }

    // Method 5: scan ALL text, collect candidates, pick smallest reasonable (avoids 200M outlier)
    if (!price) {
      const candidates = [];
      const allM = [...text.matchAll(/AED\s*([\d,]+)/gi)];
      for (const m of allM) {
        const raw = Number(m[1].replace(/,/g,''));
        if (raw >= 100000 && raw <= 100000000) candidates.push(raw); // cap at 100M
      }
      if (candidates.length > 0) {
        // Most frequent wins; ties go to smallest
        const freq = {};
        candidates.forEach(v => freq[v] = (freq[v]||0)+1);
        const sorted = Object.entries(freq).sort((a,b) => b[1]-a[1] || Number(a[0])-Number(b[0]));
        price = 'AED ' + Number(sorted[0][0]).toLocaleString();
      }
    }

    if (text.toLowerCase().includes('freehold')) tenure = 'Freehold';
    else if (text.toLowerCase().includes('leasehold')) tenure = 'Leasehold';

    // ── Description ──
    let description = '';
    if (jsonLD && jsonLD.description) description = jsonLD.description;
    else description = metaContent('og:description') || metaContent('description') || '';
    description = description.replace(/\.\.\.\s*(?:Book a Viewing Today!?)?$/i, '').trim();

    // ── Features ──
    const features = [];
    if (beds)   features.push(beds + ' Bedroom' + (parseInt(beds) > 1 ? 's' : ''));
    if (baths)  features.push(baths + ' Bathroom' + (parseInt(baths) > 1 ? 's' : ''));
    if (size)   features.push(size + ' sq ft');
    if (tenure) features.push(tenure);

    // ── Photos — extract ALL unique PF CDN images ──
    // From inspect: src="https://static.shared.propertyfinder.ae/media/images/listing/S2D2PS2EYTWT...
    const photos = [];
    const seen = new Set();

    // Method 1: og:image
    const ogImage = metaContent('og:image');
    if (ogImage && ogImage.startsWith('http') && !ogImage.includes('floorplan')) {
      photos.push(ogImage);
      seen.add(ogImage);
    }

    // Method 2: All PF CDN listing images (NOT floorplan)
    const pfImgPattern = /https:\/\/static\.shared\.propertyfinder\.ae\/media\/images\/listing\/[A-Za-z0-9]+\/[^"'\s\\]+(?:668x452|large|medium)[^"'\s\\]*\.jpg/g;
    const pfMatches = [...html.matchAll(pfImgPattern)];
    for (const m of pfMatches) {
      const src = m[0];
      if (!seen.has(src) && !src.includes('floorplan') && photos.length < 5) {
        photos.push(src);
        seen.add(src);
      }
    }

    // Method 3: Any PF CDN image fallback
    if (photos.length < 2) {
      const anyPfPattern = /https:\/\/static\.shared\.propertyfinder\.ae\/media\/images\/listing\/[^"'\s\\]+\.jpg/g;
      const anyMatches = [...html.matchAll(anyPfPattern)];
      for (const m of anyMatches) {
        const src = m[0];
        if (!seen.has(src) && !src.includes('floorplan') && !src.includes('watermark') && photos.length < 5) {
          photos.push(src);
          seen.add(src);
        }
      }
    }

    // Method 4: JSON-LD images
    if (jsonLD && jsonLD.image) {
      const imgs = Array.isArray(jsonLD.image) ? jsonLD.image : [jsonLD.image];
      imgs.forEach(img => {
        const src = typeof img === 'string' ? img : (img.url || img.contentUrl || '');
        if (src && src.startsWith('http') && !src.includes('floorplan') && !seen.has(src) && photos.length < 5) {
          photos.push(src);
          seen.add(src);
        }
      });
    }

    // ── Floor plan — PF stores as /floorplan/ in path ──
    let floorplan = '';
    // From inspect: src="https://static.shared.propertyfinder.ae/media/images/floorplan/..."
    const fpPattern = /https:\/\/static\.shared\.propertyfinder\.ae\/media\/images\/f[^"'\s\\]+(?:\.jpg|\.png|\.webp)/gi;
    const fpMatches = [...html.matchAll(fpPattern)];
    if (fpMatches.length > 0) floorplan = fpMatches[0][0];

    // Also check watermarked floor plans
    if (!floorplan) {
      const fpWater = /https:\/\/[^"'\s]+floorplan[^"'\s]+(?:\.jpg|\.png|\.webp)/gi;
      const fpWaterMatches = [...html.matchAll(fpWater)];
      if (fpWaterMatches.length > 0) floorplan = fpWaterMatches[0][0];
    }

    return res.status(200).json({ building, area, ref, beds, baths, size, price, tenure, description, features, photos, floorplan, marketingTitle });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
