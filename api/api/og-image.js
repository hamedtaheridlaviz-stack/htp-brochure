// api/og-image.js
// Proxies the first Property Finder listing photo through our own Vercel domain.
// This avoids WhatsApp having to hotlink Property Finder's CDN directly.

function allowedPhotoUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'https:') return null;
    const h = u.hostname.toLowerCase();
    if (h === 'propertyfinder.ae' || h.endsWith('.propertyfinder.ae')) return u.toString();
    return null;
  } catch (_) {
    return null;
  }
}

module.exports = async (req, res) => {
  const raw = req.query.photo || '';
  const photo = allowedPhotoUrl(raw);

  if (!photo) {
    res.writeHead(302, {
      Location: '/assets/vero-og.jpg',
      'Cache-Control': 'public, max-age=300'
    });
    return res.end();
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const upstream = await fetch(photo, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VeroPreview/1.0)',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': 'https://www.propertyfinder.ae/'
      }
    });
    clearTimeout(timeout);

    if (!upstream.ok) throw new Error(`Image upstream ${upstream.status}`);
    const type = upstream.headers.get('content-type') || 'image/jpeg';
    if (!type.toLowerCase().startsWith('image/')) throw new Error('Upstream was not an image');

    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('Invalid image size');

    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.statusCode = 200;
    res.end(bytes);
  } catch (_) {
    res.writeHead(302, {
      Location: '/assets/vero-og.jpg',
      'Cache-Control': 'public, max-age=300'
    });
    res.end();
  }
};
