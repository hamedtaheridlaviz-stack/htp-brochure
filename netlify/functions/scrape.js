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
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for key content
    await page.waitForSelector('h1', { timeout: 10000 }).catch(() => {});

    const data = await page.evaluate(() => {
      const txt = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.innerText.trim() : '';
      };
      const attr = (sel, a) => {
        const el = document.querySelector(sel);
        return el ? el.getAttribute(a) : '';
      };

      // ── Building / Area ──
      let building = txt('h1') || txt('[class*="title"]') || '';
      let area = '';
      const breadcrumbs = document.querySelectorAll('[class*="breadcrumb"] a, [class*="location"] span');
      if (breadcrumbs.length >= 2) area = breadcrumbs[breadcrumbs.length - 1].innerText.trim();
      if (!area) area = txt('[class*="area"]') || txt('[class*="location"]') || 'Dubai';

      // ── REF ──
      let ref = '';
      document.querySelectorAll('[class*="ref"], [class*="reference"]').forEach(el => {
        const t = el.innerText;
        if (t && t.match(/\d{5,}/)) ref = t.replace(/[^0-9]/g, '');
      });

      // ── Beds ──
      let beds = '';
      document.querySelectorAll('[class*="bed"], [aria-label*="bed"], [data-testid*="bed"]').forEach(el => {
        const m = el.innerText.match(/(\d+)/);
        if (m && !beds) beds = m[1];
      });
      // Fallback: look for standalone number near "bed" text
      if (!beds) {
        document.querySelectorAll('li, span, div').forEach(el => {
          if (el.children.length === 0) {
            const t = el.innerText.toLowerCase();
            if (t.includes('bed') && t.match(/\d/)) {
              const m = t.match(/(\d+)/);
              if (m) beds = m[1];
            }
          }
        });
      }

      // ── Baths ──
      let baths = '';
      document.querySelectorAll('[class*="bath"], [aria-label*="bath"], [data-testid*="bath"]').forEach(el => {
        const m = el.innerText.match(/(\d+)/);
        if (m && !baths) baths = m[1];
      });
      // Fallback: look for standalone number near "bath" text
      if (!baths) {
        document.querySelectorAll('li, span, div').forEach(el => {
          if (el.children.length === 0) {
            const t = el.innerText.toLowerCase();
            if (t.includes('bath') && t.match(/\d/)) {
              const m = t.match(/(\d+)/);
              if (m) baths = m[1];
            }
          }
        });
      }
      // PropertyFinder specific: check icon containers
      if (!baths) {
        document.querySelectorAll('[class*="attribute"], [class*="feature"], [class*="spec"]').forEach(el => {
          const text = el.innerText.toLowerCase();
          if (text.includes('bath')) {
            const m = text.match(/(\d+)/);
            if (m) baths = m[1];
          }
        });
      }

      // ── Size ──
      let size = '';
      document.querySelectorAll('[class*="size"], [class*="area"], [aria-label*="size"]').forEach(el => {
        const m = el.innerText.match(/([\d,]+)\s*(sq\.?\s*ft|sqft|ft²)/i);
        if (m && !size) size = m[1].replace(/,/g, '');
      });
      if (!size) {
        const bodyText = document.body.innerText;
        const m = bodyText.match(/([\d,]+)\s*sq\.?\s*ft/i);
        if (m) size = m[1].replace(/,/g, '');
      }

      // ── Price — fix: grab full number including commas/thousands ──
      let price = '';
      let tenure = '';
      document.querySelectorAll('[class*="price"]').forEach(el => {
        const t = el.innerText.trim();
        // Match AED followed by full number (with commas or spaces)
        const m = t.match(/AED\s*([\d,\s]+)/i);
        if (m && !price) {
          // Clean up: remove spaces inside number, keep commas
          price = 'AED ' + m[1].replace(/\s/g, '').replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
          // Remove duplicate commas
          price = price.replace(/,+/g, ',');
        }
      });
      // Fallback: scan entire page for AED price pattern
      if (!price || price === 'AED ') {
        const bodyText = document.body.innerText;
        const m = bodyText.match(/AED\s*([\d,]+(?:\s*,\s*[\d]+)*)/i);
        if (m) {
          const raw = m[1].replace(/\s/g, '');
          price = 'AED ' + raw;
        }
      }

      // Tenure (Freehold / Leasehold)
      if (document.body.innerText.toLowerCase().includes('freehold')) tenure = 'Freehold';
      else if (document.body.innerText.toLowerCase().includes('leasehold')) tenure = 'Leasehold';

      // ── Description — get FULL text ──
      let description = '';
      // Try common description selectors
      const descSelectors = [
        '[class*="description"] p',
        '[class*="desc"] p',
        '[data-testid*="description"]',
        '[class*="overview"] p',
        'article p',
      ];
      for (const sel of descSelectors) {
        const els = document.querySelectorAll(sel);
        if (els.length) {
          description = Array.from(els).map(e => e.innerText.trim()).filter(Boolean).join('\n\n');
          if (description.length > 50) break;
        }
      }
      // Fallback: find largest text block
      if (!description || description.length < 50) {
        let longest = '';
        document.querySelectorAll('p, [class*="text"]').forEach(el => {
          const t = el.innerText.trim();
          if (t.length > longest.length && t.length > 100 && !t.includes('Cookie') && !t.includes('©')) {
            longest = t;
          }
        });
        description = longest;
      }

      // ── Features ──
      const features = [];
      document.querySelectorAll('[class*="feature"] li, [class*="amenity"] li, [class*="highlight"] li').forEach(el => {
        const t = el.innerText.trim();
        if (t && t.length < 80) features.push(t);
      });
      // Also grab beds/size as feature bullets if list empty
      if (features.length === 0) {
        if (beds) features.push(beds + ' bedroom apartment');
        if (size) features.push(size + ' sq ft');
      }

      // ── Photos ──
      const photos = [];
      document.querySelectorAll('[class*="gallery"] img, [class*="photo"] img, [class*="image"] img').forEach(img => {
        const src = img.src || img.getAttribute('data-src') || '';
        if (src && src.startsWith('http') && !src.includes('avatar') && !src.includes('logo') && !src.includes('icon') && photos.length < 4) {
          photos.push(src);
        }
      });
      // Fallback: any large image
      if (photos.length === 0) {
        document.querySelectorAll('img').forEach(img => {
          const src = img.src || '';
          if (src && src.startsWith('http') && img.naturalWidth > 300 && photos.length < 4) {
            photos.push(src);
          }
        });
      }

      // ── Floor plan ──
      let floorplan = '';
      document.querySelectorAll('img').forEach(img => {
        const src = img.src || img.getAttribute('data-src') || '';
        const alt = (img.alt || '').toLowerCase();
        if ((alt.includes('floor') || alt.includes('plan') || src.toLowerCase().includes('floor')) && !floorplan) {
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
