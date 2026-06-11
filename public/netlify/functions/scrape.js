const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

exports.handler = async (event) => {
  const url = event.queryStringParameters && event.queryStringParameters.url;
  if (!url) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No URL provided' }) };
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
      defaultViewport: { width: 1280, height: 900 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // Disguise automation
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

    // Wait for PropertyFinder content to render
    await page.waitForFunction(() => document.body.innerText.length > 500, { timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    const data = await page.evaluate(() => {
      const q  = (s) => document.querySelector(s);
      const qa = (s) => Array.from(document.querySelectorAll(s));
      const tx = (s) => { const e = q(s); return e ? e.innerText.trim() : ''; };

      // ── Building name ──
      let building = tx('h1') || tx('[class*="title-primary"]') || tx('[class*="property-title"]') || '';
      building = building.replace(/\n.*/s, '').trim(); // first line only

      // ── Area ──
      let area = '';
      const locEls = qa('[class*="location"], [class*="breadcrumb"] a, [class*="address"]');
      for (const el of locEls) {
        const t = el.innerText.trim();
        if (t && t.length < 60 && t !== building) { area = t; break; }
      }
      if (!area) {
        // Try to extract "Dubai" or known area from title
        const m = (tx('h1') + ' ' + document.title).match(/,\s*([^,]+),\s*Dubai/);
        if (m) area = m[1].trim() + ', Dubai';
        else area = 'Dubai';
      }

      // ── REF ──
      let ref = '';
      qa('[class*="ref"], [class*="reference"], [class*="id"]').forEach(el => {
        const m = el.innerText.match(/\b(\d{6,})\b/);
        if (m && !ref) ref = m[1];
      });

      // ── Stats: PropertyFinder uses data attributes or specific class patterns ──
      let beds = '', baths = '', size = '';

      // Method 1: data-testid or aria attributes
      qa('[data-testid*="bed"], [aria-label*="bed"], [class*="beds"]').forEach(el => {
        const m = el.innerText.match(/(\d+)/);
        if (m && !beds) beds = m[1];
      });
      qa('[data-testid*="bath"], [aria-label*="bath"], [class*="bath"]').forEach(el => {
        const m = el.innerText.match(/(\d+)/);
        if (m && !baths) baths = m[1];
      });
      qa('[data-testid*="size"], [aria-label*="size"], [class*="size"], [class*="area"]').forEach(el => {
        const m = el.innerText.match(/([\d,]+)\s*sq/i);
        if (m && !size) size = m[1].replace(/,/g,'');
      });

      // Method 2: scan icon blocks (PropertyFinder groups bed/bath/size in icon rows)
      if (!beds || !baths) {
        qa('[class*="icon-group"], [class*="property-stat"], [class*="attribute"]').forEach(block => {
          const txt = block.innerText.toLowerCase();
          const num = (block.innerText.match(/(\d+)/) || [])[1];
          if (!num) return;
          if (txt.includes('bed') && !beds) beds = num;
          if (txt.includes('bath') && !baths) baths = num;
          if (txt.includes('sq') && !size) size = num;
        });
      }

      // Method 3: raw text scan of full page as last resort
      if (!beds || !baths) {
        const allText = document.body.innerText;
        if (!beds) { const m = allText.match(/(\d)\s*Bed/i); if (m) beds = m[1]; }
        if (!baths) { const m = allText.match(/(\d)\s*Bath/i); if (m) baths = m[1]; }
        if (!size) { const m = allText.match(/([\d,]+)\s*sq\.?\s*ft/i); if (m) size = m[1].replace(/,/g,''); }
      }

      // ── Price ──
      let price = '', tenure = '';
      const fullText = document.body.innerText;

      // PropertyFinder price format: "AED 5,800,000" or "5,800,000 AED"
      const priceMatch = fullText.match(/AED\s*([\d,]+)/i) || fullText.match(/([\d,]+)\s*AED/i);
      if (priceMatch) {
        const raw = priceMatch[1].replace(/,/g,'');
        if (raw.length >= 5) { // avoid matching small numbers
          price = 'AED ' + Number(raw).toLocaleString();
        }
      }

      if (fullText.toLowerCase().includes('freehold')) tenure = 'Freehold';
      else if (fullText.toLowerCase().includes('leasehold')) tenure = 'Leasehold';

      // ── Description — full text, not truncated ──
      let description = '';
      const descCandidates = [
        '[class*="description"]',
        '[class*="desc"]',
        '[data-testid*="description"]',
        '[class*="overview"]',
        '[class*="about"]',
      ];
      for (const sel of descCandidates) {
        const els = qa(sel + ' p, ' + sel);
        const text = els.map(e => e.innerText.trim()).filter(t => t.length > 80).join('\n\n');
        if (text.length > 100) { description = text; break; }
      }
      // Fallback: longest paragraph
      if (description.length < 100) {
        let best = '';
        qa('p').forEach(el => {
          const t = el.innerText.trim();
          if (t.length > best.length && t.length > 100 && !t.includes('Cookie') && !t.includes('©') && !t.includes('Terms')) best = t;
        });
        description = best;
      }

      // ── Features ──
      let features = [];
      qa('[class*="feature"] li, [class*="amenity"] li, [class*="highlight"] li, [class*="permit"] li').forEach(el => {
        const t = el.innerText.trim();
        if (t && t.length < 80 && !features.includes(t)) features.push(t);
      });
      if (features.length === 0 && (beds || size)) {
        if (beds) features.push(beds + ' Bedroom' + (parseInt(beds) > 1 ? 's' : ''));
        if (size) features.push(size + ' sq ft');
      }

      // ── Photos ──
      const photos = [];
      const seenSrcs = new Set();
      // Gallery images first
      qa('[class*="gallery"] img, [class*="carousel"] img, [class*="slider"] img, [class*="photo"] img').forEach(img => {
        const src = img.src || img.dataset.src || img.dataset.lazySrc || '';
        if (src && src.startsWith('http') && !src.includes('logo') && !src.includes('avatar') && !src.includes('icon') && !seenSrcs.has(src) && photos.length < 4) {
          photos.push(src);
          seenSrcs.add(src);
        }
      });
      // Fallback: any large enough image
      if (photos.length === 0) {
        qa('img').forEach(img => {
          const src = img.src || '';
          if (src && src.startsWith('http') && (img.naturalWidth > 400 || img.width > 400) && !seenSrcs.has(src) && photos.length < 4) {
            photos.push(src);
            seenSrcs.add(src);
          }
        });
      }

      // ── Floor plan ──
      let floorplan = '';
      qa('img').forEach(img => {
        const src = img.src || img.dataset.src || '';
        const alt = (img.alt || '').toLowerCase();
        if (!floorplan && (alt.includes('floor') || alt.includes('plan') || src.toLowerCase().includes('floor-plan') || src.toLowerCase().includes('floorplan'))) {
          floorplan = src;
        }
      });

      return { building, area, ref, beds, baths, size, price, tenure, description, features, photos, floorplan };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(data),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  } finally {
    if (browser) await browser.close();
  }
};
