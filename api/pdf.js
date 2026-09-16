const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

function safePart(v){return String(v||'').replace(/AED\s*/ig,'AED ').replace(/[\\/:*?"<>|]+/g,' ').replace(/\s+/g,' ').trim().slice(0,90)}
function filenameFrom(parts){const f=parts.map(safePart).filter(Boolean).join(' - ') || 'Vero Property Brochure';return f.toLowerCase().endsWith('.pdf')?f:f+'.pdf'}
module.exports = async (req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
  const pfUrl=req.query.url;if(!pfUrl){res.statusCode=400;return res.end('Missing url')}
  const proto=req.headers['x-forwarded-proto']||'https';const host=req.headers.host;
  let fname=req.query.filename||'';
  if(!fname){try{const r=await fetch(`${proto}://${host}/api/scrape?url=${encodeURIComponent(pfUrl)}`);const d=await r.json();fname=filenameFrom([d.area,d.building,d.price])}catch(_){fname='Vero Property Brochure.pdf'}}
  else fname=filenameFrom([fname.replace(/\.pdf$/i,'')]);
  let browser;
  try{
    browser=await puppeteer.launch({args:chromium.args,defaultViewport:chromium.defaultViewport,executablePath:await chromium.executablePath(),headless:chromium.headless});
    const page=await browser.newPage();
    const pageUrl=`${proto}://${host}/brochure?url=${encodeURIComponent(pfUrl)}&print=1`;
    await page.goto(pageUrl,{waitUntil:'networkidle0',timeout:30000});
    await page.waitForFunction(()=>window.__VERO_BROCHURE_READY===true,{timeout:20000}).catch(()=>{});
    const pdf=await page.pdf({format:'A4',landscape:true,printBackground:true,margin:{top:0,right:0,bottom:0,left:0},preferCSSPageSize:true});
    res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);res.setHeader('Cache-Control','private, no-store');res.statusCode=200;res.end(pdf);
  }catch(e){res.statusCode=500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e.message}))}
  finally{if(browser)await browser.close().catch(()=>{})}
};
