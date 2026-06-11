exports.handler = async (event) => {
  const url = event.queryStringParameters && event.queryStringParameters.url;
  const headers = { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' };
  try {
    if (!url || !/^https?:\/\//i.test(url)) return json(400,{error:'Missing or invalid url'},headers);

    const res = await fetch(url, {
      redirect:'follow',
      headers:{
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
        'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language':'en-AE,en;q=0.9',
        'cache-control':'no-cache'
      }
    });
    const html = await res.text();
    if (!res.ok || html.length < 500) return json(502,{error:'PropertyFinder fetch failed',status:res.status,bytes:html.length},headers);

    const text = decode(stripTags(html)).replace(/\s+/g,' ').trim();
    const data = extractStructured(html);
    const title = first(data.title, meta(html,'og:title'), match(html,/<h1[^>]*>([\s\S]*?)<\/h1>/i), betweenText(text, 'Apartment for sale', 'Call'));
    const description = first(data.description, meta(html,'description'), match(html,/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?"description"\s*:\s*"([\s\S]*?)"/i));
    const price = formatAED(first(data.price, meta(html,'product:price:amount'), findPrice(text), match(text,/AED\s*([0-9][0-9,\.\s]{4,})/i)));
    const beds = first(data.beds, match(text,/(\d+)\s*(?:bedrooms?|beds?|BR)\b/i), match(text,/Apartment\s*-\s*(\d+)\s*Bedroom/i));
    const baths = first(data.baths, match(text,/(\d+)\s*(?:bathrooms?|baths?)\b/i), match(text,/Bedroom[s]?\s*-\s*(\d+)\s*Bathroom/i));
    const size = formatSize(first(data.size, match(text,/([0-9][0-9,\.\s]{2,})\s*(?:sq\.?\s*ft|sqft)/i)));
    const location = first(data.location, findLocation(text));
    const photo = first(data.photo, meta(html,'og:image'), findImage(html));
    const features = data.features.length ? data.features : inferFeatures(text);
    const reference = first(match(text,/(?:Reference|Property reference|Permit No\.?|BRN|Trakheesi)[\s:#-]*([A-Z0-9\/-]{4,})/i), url.split('-').pop().replace(/\.html.*/,''));

    return json(200,{title:cleanTitle(title), location, price, beds:digits(beds), baths:digits(baths), size, description:cleanDesc(description), photo, floorPlan:'', features, reference, source:url},headers);
  } catch (err) {
    return json(500,{error: err.message || String(err)},headers);
  }
};
function json(statusCode, body, headers){ return {statusCode, headers, body:JSON.stringify(body)}; }
function decode(s=''){return String(s).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#x27;|&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ')}
function stripTags(s=''){return String(s).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')}
function match(s,re){const m=String(s||'').match(re);return m?decode(m[1]||m[0]):''}
function meta(html,prop){return match(html,new RegExp(`<meta[^>]+(?:property|name)=["']${prop.replace(':','\\:')}["'][^>]+content=["']([^"']+)["']`,'i')) || match(html,new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop.replace(':','\\:')}["']`,'i'))}
function first(...vals){for(const v of vals){if(v!==undefined&&v!==null&&String(v).trim()&&String(v).trim()!=='—')return String(v).trim()}return''}
function digits(v){const m=String(v||'').match(/\d+/);return m?m[0]:''}
function formatAED(v){let n=String(v||'').replace(/[^0-9]/g,''); if(!n)return''; if(n.length<=3)return''; return 'AED '+Number(n).toLocaleString('en-US');}
function formatSize(v){let n=String(v||'').replace(/[^0-9]/g,''); return n?Number(n).toLocaleString('en-US'):''}
function cleanTitle(t){return decode(String(t||'')).replace(/\s*\|\s*Property Finder.*$/i,'').replace(/\s*for sale in.*$/i,'').trim()}
function cleanDesc(d){return decode(String(d||'')).replace(/\\n/g,'\n').replace(/\s{2,}/g,' ').trim()}
function findPrice(t){const m=String(t).match(/(?:Apartment|Villa|Townhouse)?\s*(?:AED\s*)?([1-9][0-9,]{5,})\s*(?:AED)?/i);return m?m[1]:''}
function findLocation(t){const m=String(t).match(/((?:[A-Za-z]+\s*){1,4},\s*(?:Oceana|Palm Jumeirah|Dubai Marina|Downtown Dubai|Dubai)[^\.]{0,80})/i);return m?m[1].trim():''}
function findImage(html){const imgs=[...String(html).matchAll(/https?:\\?\/\\?\/[^"'\s<>]+(?:propertyfinder|cloudfront|pfcdn)[^"'\s<>]+\.(?:jpg|jpeg|png|webp)[^"'\s<>]*/gi)].map(m=>m[0].replace(/\\\//g,'/'));return imgs.find(x=>/property|image|photo|static/.test(x))||imgs[0]||''}
function inferFeatures(t){const out=[];[['Private beach','private beach'],['Vacant','vacant'],['Furnished','furnished'],['Balcony','balcony'],['Sea view','sea view'],['Marina view','marina view'],['Shared pool','pool'],['Shared gym','gym'],['Parking','parking'],['Security','security']].forEach(([label,key])=>{if(new RegExp(key,'i').test(t))out.push(label)});return out.slice(0,10)}
function betweenText(t,a,b){const i=t.toLowerCase().indexOf(a.toLowerCase()); if(i<0)return''; const j=t.toLowerCase().indexOf(b.toLowerCase(),i+a.length); return t.slice(i,j>i?j:i+160)}
function extractStructured(html){const out={features:[]};
  for(const m of String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{const raw=decode(m[1]); const obj=JSON.parse(raw); scan(obj,out);}catch(e){}
  }
  const next=match(html,/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if(next){try{scan(JSON.parse(decode(next)),out)}catch(e){}}
  return out;
}
function scan(x,out){ if(!x)return; if(Array.isArray(x)){x.forEach(v=>scan(v,out));return;} if(typeof x==='object'){
  for(const [k,v] of Object.entries(x)){const key=k.toLowerCase(); if(v==null)continue;
    if(!out.title && ['name','title'].includes(key) && typeof v==='string' && v.length>8) out.title=v;
    if(!out.description && key.includes('description') && typeof v==='string' && v.length>30) out.description=v;
    if(!out.price && key.includes('price') && String(v).match(/\d{5,}/)) out.price=v;
    if(!out.photo && (key==='image'||key.includes('photo'))){ if(typeof v==='string') out.photo=v; if(Array.isArray(v)&&v[0]) out.photo=typeof v[0]==='string'?v[0]:(v[0].url||''); }
    if(!out.beds && key.includes('bed')) out.beds=String(v);
    if(!out.baths && key.includes('bath')) out.baths=String(v);
    if(!out.size && (key.includes('size')||key.includes('area'))) out.size=String(v);
    if(!out.location && (key.includes('address')||key.includes('location')) && typeof v==='string' && /Dubai|Palm|Marina|Oceana/i.test(v)) out.location=v;
    if((key.includes('amenit')||key.includes('feature')) && Array.isArray(v)) out.features.push(...v.map(String));
    scan(v,out);
  }} }
