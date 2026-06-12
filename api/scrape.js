const https = require('https');
const http = require('http');

function fetchUrl(url) {
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
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── Vercel handler format ──
module.exports = async (req, res) => {
  const url = req.query && req.query.url;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (!url) {
    return res.status(400).json({ error: 'No URL provided' });
  }

  try {
    const html = await fetchUrl(url);

    // ── JSON-LD structured data ──
    let jsonLD = null;
    const jsonLDMatches = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const match of jsonLDMatches) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.name || parsed.price || parsed['@type']) { jsonLD = parsed; break; }
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

    // ── Clean text ──
    const cleanHtml = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');
    const text = cleanHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // ── Building ──
    let building = (jsonLD && jsonLD.name) || metaContent('og:title') || '';
    building = building.replace(/\s*[-|].*?(PropertyFinder|Bayut|betterhomes).*/i, '').trim();
    building = building.replace(/^[\d\w\s]+\|\s*/i, '').trim();

    // ── Area ──
    let area = '';
    if (jsonLD && jsonLD.address) area = jsonLD.address.addressLocality || '';
    if (!area) {
      const m = (metaContent('og:title') || '').match(/in\s+([^,|]+(?:,\s*[^,|]+)?)\s*[-|]/i);
      if (m) area = m[1].trim();
    }
    if (!area) area = 'Dubai';

    // ── Beds / Baths / Size ──
    let beds = '', baths = '', size = '';
    if (jsonLD) {
      beds  = String(jsonLD.numberOfRooms || jsonLD.numberOfBedrooms || '');
      baths = String(jsonLD.numberOfBathroomsTotal || jsonLD.numberOfBathrooms || '');
      if (jsonLD.floorSize) size = String(jsonLD.floorSize.value || '');
    }
    if (!beds)  { const m = text.match(/(\d+)\s*Bed(?:room)?s?/i);  if (m) beds  = m[1]; }
    if (!baths) { const m = text.match(/(\d+)\s*Bath(?:room)?s?/i); if (m) baths = m[1]; }
    if (!size)  { const m = text.match(/([\d,]+)\s*sq\.?\s*(?:ft|feet)/i); if (m) size = m[1].replace(/,/g,''); }

    // ── Price ──
    let price = '', tenure = '';
    if (jsonLD && jsonLD.offers && jsonLD.offers.price) {
      price = 'AED ' + Number(jsonLD.offers.price).toLocaleString();
    }
    if (!price) {
      const m = text.match(/AED\s*([\d,]+)/i);
      if (m) { const raw = m[1].replace(/,/g,''); if (raw.length >= 5) price = 'AED ' + Number(raw).toLocaleString(); }
    }
    if (text.toLowerCase().includes('freehold')) tenure = 'Freehold';
    else if (text.toLowerCase().includes('leasehold')) tenure = 'Leasehold';

    // ── Description ──
    let description = (jsonLD && jsonLD.description) || metaContent('og:description') || metaContent('description') || '';
    description = description.replace(/\.\.\.$/, '').trim();

    // ── Features ──
    const features = [];
    if (beds)   features.push(beds + ' Bedroom' + (parseInt(beds) > 1 ? 's' : ''));
    if (baths)  features.push(baths + ' Bathroom' + (parseInt(baths) > 1 ? 's' : ''));
    if (size)   features.push(size + ' sq ft');
    if (tenure) features.push(tenure);

    // ── Photos ──
    const photos = [];
    const ogImage = metaContent('og:image');
    if (ogImage) photos.push(ogImage);
    if (jsonLD && jsonLD.image) {
      const imgs = Array.isArray(jsonLD.image) ? jsonLD.image : [jsonLD.image];
      imgs.forEach(img => {
        const src = typeof img === 'string' ? img : (img.url || img.contentUrl || '');
        if (src && !photos.includes(src) && photos.length < 4) photos.push(src);
      });
    }
    const cdnMatches = [...html.matchAll(/https:\/\/static\.shared\.propertyfinder\.ae\/media\/images\/listing\/[^"'\s]+\.jpg/g)];
    cdnMatches.forEach(m => { if (!photos.includes(m[0]) && photos.length < 4) photos.push(m[0]); });

    // ── REF ──
    let ref = '';
    const refM = html.match(/(?:ref|reference)[^>]*?[:\s#]+([A-Z0-9]{6,})/i);
    if (refM) ref = refM[1];

    return res.status(200).json({ building, area, ref, beds, baths, size, price, tenure, description, features, photos, floorplan: '' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
