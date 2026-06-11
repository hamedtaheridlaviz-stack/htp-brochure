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
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
      ],
      defaultViewport: { width: 1280, height: 900 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
    });

    // Intercept and block images/fonts to speed up load
    await page.setRequestInterception(true);
    page.on('request', req => {
      const rt = req.resourceType();
      if (['font', 'stylesheet'].includes(rt)) req.abort();
      else req.continue();
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

    // Wait for content — PropertyFinder renders via React, need to wait
    await page.waitForFunction(
      () => document.body.innerText.length > 1000,
      { timeout: 12000 }
    ).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    const data = await page.evaluate(() => {
      // Helpers
      const q  = s => document.querySelector(s);
      const qa = s => Array.from(document.querySelectorAll(s));
      const tx = s => { const e = q(s); return e ? e.innerText.trim() : ''; };

      // ── Building name from h1 ──
      let building = '';
      const h1 = q('h1');
      if (h1) building = h1.innerText.trim().split('\n')[0].trim();

      // ── Area — from page title or breadcrumbs ──
      let area = '';
      // PropertyFinder breadcrumb structure
      const breadLinks = qa('nav a, [class*="breadcrumb"] a, [class*="Breadcrumb"] a');
      if (breadLinks.length >= 2) {
        area = breadLinks[breadLinks.length - 1].innerText.trim();
      }
      if (!area) {
        // From <title>: "3 BR | Apartment | Oceana Pacific, Dubai"
        const title = document.title;
        const m = title.match(/([^|,]+),\s*Dubai/);
        if (m) area = m[1].trim() + ', Dubai';
      }
      if (!area) area = 'Dubai';

      // ── REF ──
      let ref = '';
      const refMatch = document.body.innerText.match(/(?:ref(?:erence)?|id)[:\s#]*([A-Z0-9]{5,})/i);
      if (refMatch) ref = refMatch[1];

      // ── Stats — PropertyFinder uses spans/divs with text like "3 Beds" "4 Baths" "2,279 sq. ft." ──
      let beds = '', baths = '', size = '';

      // Try all elements that contain numbers near bed/bath/sq text
      qa('span, div, li, p').forEach(el => {
        if (el.children.length > 2) return; // skip containers
        const t = el.innerText.trim().toLowerCase();
        if (!t || t.length > 50) return;

        if (!beds && /^\d+\s*bed/i.test(t)) beds = t.match(/(\d+)/)[1];
        if (!baths && /^\d+\s*bath/i.test(t)) baths = t.match(/(\d+)/)[1];
        if (!size && /[\d,]+\s*sq/i.test(t)) {
          const m = t.match(/([\d,]+)\s*sq/i);
          if (m) size = m[1].replace(/,/g, '');
        }
      });

      // Fallback: scan raw page text
      const rawText = document.body.innerText;
      if (!beds)  { const m = rawText.match(/(\d)\s*Bed/);  if (m) beds  = m[1]; }
      if (!baths) { const m = rawText.match(/(\d)\s*Bath/); if (m) baths = m[1]; }
      if (!size)  { const m = rawText.match(/([\d,]+)\s*sq\.?\s*ft/i); if (m) size = m[1].replace(/,/g,''); }

      // ── Price — full number e.g. 5,800,000 ──
      let price = '', tenure = '';
      // PropertyFinder shows price as "AED 5,800,000" in a heading/span
      const priceEls = qa('[class*="price"], [class*="Price"], h2, h3, strong');
      for (const el of priceEls) {
        const t = el.innerText.trim();
        const m = t.match(/AED\s*([\d,]+)/i);
        if (m) {
          const raw = m[1].replace(/,/g, '');
          if (raw.length >= 5) { // must be at least 5 digits (10,000+)
            price = 'AED ' + Number(raw).toLocaleString();
            break;
          }
        }
      }
      // Raw text fallback
      if (!price) {
        const m = rawText.match(/AED\s*([\d,]+)/i);
        if (m) {
          const raw = m[1].replace(/,/g, '');
          if (raw.length >= 5) price = 'AED ' + Number(raw).toLocaleString();
        }
      }

      if (rawText.toLowerCase().includes('freehold')) tenure = 'Freehold';
      else if (rawText.toLowerCase().includes('leasehold')) tenure = 'Leasehold';

      // ── Description — FULL text, not truncated ──
      let description = '';

      // PropertyFinder description is usually in a section with "Description" heading
      // Try to find the section after a "Description" heading
      const headings = qa('h2, h3, h4, [class*="heading"], [class*="section-title"]');
      for (const h of headings) {
        if (h.innerText.trim().toLowerCase() === 'description' || h.innerText.trim().toLowerCase() === 'about') {
          // Get the next sibling paragraphs
          let next = h.nextElementSibling;
          let text = '';
          while (next && text.length < 2000) {
            text += next.innerText.trim() + '\n\n';
            next = next.nextElementSibling;
            if (next && (next.tagName === 'H2' || next.tagName === 'H3')) break;
          }
          if (text.length > 100) { description = text.trim(); break; }
        }
      }

      // Fallback: largest meaningful paragraph block
      if (!description || description.length < 100) {
        let best = '';
        qa('p, [class*="description"] div, [class*="desc"] div').forEach(el => {
          const t = el.innerText.trim();
          if (
            t.length > best.length &&
            t.length > 100 &&
            !t.includes('Cookie') &&
            !t.includes('©') &&
            !t.includes('Terms of') &&
            !t.includes('Privacy')
          ) best = t;
        });
        description = best;
      }

      // ── Features / amenities ──
      const features = [];
      const featSels = [
        '[class*="amenity"] li',
        '[class*="feature"] li',
        '[class*="highlight"] li',
        '[class*="Amenity"] li',
        '[class*="Feature"] li',
      ];
      for (const sel of featSels) {
        qa(sel).forEach(el => {
          const t = el.innerText.trim();
          if (t && t.length < 60 && !features.includes(t)) features.push(t);
        });
        if (features.length >= 6) break;
      }
      if (features.length === 0) {
        if (beds) features.push(beds + ' Bedroom' + (parseInt(beds) > 1 ? 's' : ''));
        if (size) features.push(size + ' sq ft');
        if (tenure) features.push(tenure);
      }

      // ── Photos — grab from img tags, prefer large gallery images ──
      const photos = [];
      const seen = new Set();

      // PropertyFinder images are on static.shared.propertyfinder.ae
      qa('img').forEach(img => {
        const src = img.src || img.dataset.src || img.dataset.lazySrc || '';
        if (
          src &&
          src.startsWith('http') &&
          !seen.has(src) &&
          !src.includes('logo') &&
          !src.includes('avatar') &&
          !src.includes('icon') &&
          !src.includes('placeholder') &&
          !src.includes('map') &&
          (src.includes('propertyfinder') || src.includes('static.shared') || src.includes('images/listing')) &&
          photos.length < 4
        ) {
          photos.push(src);
          seen.add(src);
        }
      });

      // Wider fallback if no PF images found
      if (photos.length === 0) {
        qa('img').forEach(img => {
          const src = img.src || '';
          const w = img.naturalWidth || img.width || 0;
          if (src && src.startsWith('http') && w > 300 && !seen.has(src) && photos.length < 4) {
            photos.push(src);
            seen.add(src);
          }
        });
      }

      // ── Floor plan ──
      let floorplan = '';
      qa('img').forEach(img => {
        const src = img.src || img.dataset.src || '';
        const alt = (img.alt || '').toLowerCase();
        if (!floorplan && (alt.includes('floor') || alt.includes('plan') || src.toLowerCase().includes('floor'))) {
          floorplan = src;
        }
      });

      return { building, area, ref, beds, baths, size, price, tenure, description, features, photos, floorplan };
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
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
