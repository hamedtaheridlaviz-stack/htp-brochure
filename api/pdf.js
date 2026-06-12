const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

module.exports = async (req, res) => {
  const url = req.query && req.query.url;
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!url) return res.status(400).send('No URL');

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    // Load the brochure page
    const brochureUrl = `https://htp-brochure.vercel.app/brochure?url=${encodeURIComponent(url)}`;
    await page.goto(brochureUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    // Wait for scraper to finish loading data
    await page.waitForFunction(() => !document.getElementById('loading') || document.getElementById('loading').style.display === 'none', { timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000));

    const pdf = await page.pdf({
      format: 'A5',
      landscape: true,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="brochure.pdf"');
    res.send(pdf);

  } catch (err) {
    res.status(500).send('PDF error: ' + err.message);
  } finally {
    if (browser) await browser.close();
  }
};
