// netlify/functions/scrape.js
// Serverless function — scrapes a Property Finder listing and returns clean JSON

const https = require("https");
const http  = require("http");

function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("Too many redirects"));
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Cache-Control": "no-cache",
        "Referer": "https://www.google.com/",
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function getMeta(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, "i"),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
  }
  return "";
}

function extractNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return {};
  try { return JSON.parse(m[1]); } catch { return {}; }
}

function extractImages(html, nextData) {
  const images = [];

  try {
    const pageProps = nextData?.props?.pageProps || {};
    const listing = pageProps.listing || pageProps.property || pageProps.data?.listing || {};
    const photos  = listing.photos || listing.images || listing.media || [];
    for (const p of photos) {
      const u = typeof p === "string" ? p : (p.url || p.src || p.href || "");
      if (u && !images.includes(u)) images.push(u);
    }
  } catch {}

  const ogImg = getMeta(html, "og:image");
  if (ogImg && !images.includes(ogImg)) images.unshift(ogImg);

  const imgPattern = /https:\/\/static\.shared\.propertyfinder\.ae\/media\/images\/listing\/[^\s"']+/g;
  let m;
  while ((m = imgPattern.exec(html)) !== null) {
    let url = m[0].replace(/&amp;/g, "&");
    url = url.replace(/\/\d+x\d+\./, "/1200x900.").replace(/_\d+x\d+\./, "_1200x900.");
    if (!images.some(i => i.split("?")[0] === url.split("?")[0])) {
      images.push(url);
    }
    if (images.length >= 10) break;
  }

  const seen = new Set();
  const deduped = images.filter(u => {
    const key = u.split("?")[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const floorplan = deduped.find(u =>
    u.toLowerCase().includes("floorplan") ||
    u.toLowerCase().includes("floor_plan") ||
    u.toLowerCase().includes("floor-plan")
  ) || "";

  return { images: deduped.slice(0, 8), floorplan };
}

function parseFeatures(description, beds, size, ptype) {
  const features = [];
  const d = (description || "").toLowerCase();

  if (beds) features.push(`${beds} bedroom ${(ptype || "apartment").toLowerCase()}`);
  if (size) features.push(`${Number(size).toLocaleString()} sq ft`);

  const checks = [
    ["Private pool",             "pool"],
    ["Sea view",                 "sea view"],
    ["Full sea view",            "full sea"],
    ["Atlantis view",            "atlantis"],
    ["Fully furnished",          "fully furnished"],
    ["Furnished",                "furnished"],
    ["Private beach access",     "beach access"],
    ["Private garden",           "garden"],
    ["Balcony",                  "balcony"],
    ["Terrace",                  "terrace"],
    ["2 parking spaces",         "2 parking"],
    ["Parking included",         "parking"],
    ["Gym",                      "gym"],
    ["Concierge service",        "concierge"],
    ["Maid's room",              "maid"],
    ["Study room",               "study"],
    ["Built-in storage",         "storage"],
    ["Smart home system",        "smart home"],
    ["Floor-to-ceiling windows", "floor-to-ceiling"],
    ["Vacant on transfer",       "vacant"],
    ["Tenanted",                 "tenanted"],
    ["Upgraded",                 "upgraded"],
    ["Corner unit",              "corner"],
    ["High floor",               "high floor"],
    ["Duplex",                   "duplex"],
    ["Penthouse",                "penthouse"],
  ];
  for (const [label, kw] of checks) {
    if (d.includes(kw) && !features.includes(label)) features.push(label);
  }
  while (features.length < 8) features.push("");
  return features.slice(0, 8);
}

exports.handler = async function(event) {
  const url = event.queryStringParameters?.url;

  if (!url || !url.includes("propertyfinder.ae")) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Invalid or missing Property Finder URL" })
    };
  }

  try {
    const html     = await fetchUrl(url);
    const nextData = extractNextData(html);

    const pageProps = nextData?.props?.pageProps || {};
    const listing   = pageProps.listing || pageProps.property || pageProps.data?.listing || {};

    const ogTitle = getMeta(html, "og:title").replace(" | Property Finder", "").trim();
    const ogDesc  = getMeta(html, "og:description");

    const building  = listing.building || listing.buildingName || (() => {
      const m = ogTitle.match(/(?:Sale|Rent) in ([^:]+)/i);
      return m ? m[1].trim() : "";
    })();
    const community = listing.community || listing.neighborhood || "";
    const city      = listing.city || "Dubai";

    let price = listing.price || listing.rent || "";
    if (!price) {
      const pm = html.match(/AED[\s]*([\d,]+)/);
      price = pm ? parseInt(pm[1].replace(/,/g, "")) : 0;
    }
    const priceFormatted = price
      ? `AED ${parseInt(price).toLocaleString()}`
      : "Price on Request";

    const beds    = String(listing.bedrooms || listing.beds || (() => {
      const m = ogDesc.match(/(\d+)\s*bed/i); return m ? m[1] : "";
    })() || "");
    const baths   = String(listing.bathrooms || listing.baths || "");
    const size    = String(listing.size || listing.area || listing.totalArea || (() => {
      const m = ogDesc.match(/([\d,]+)\s*sqft/i); return m ? m[1].replace(/,/g,"") : "";
    })() || "");
    const ptype   = listing.type || listing.propertyType || "Apartment";
    const ref     = String(listing.referenceNumber || listing.reference || listing.id || "");
    const purpose = listing.purpose || (url.includes("/buy/") ? "Sale" : "Rent");
    const desc    = listing.description || ogDesc || "";

    const { images, floorplan } = extractImages(html, nextData);
    const features = parseFeatures(desc, beds, size, ptype);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({
        ADDRESS:      [building, community, city].filter(Boolean).join(", "),
        BUILDING:     building || community,
        AREA:         [community, city].filter(Boolean).join(", "),
        PRICE:        priceFormatted,
        BEDS:         beds || "—",
        BATHS:        baths || "—",
        SIZE:         size ? Number(size).toLocaleString() : "—",
        SIZE_M:       size ? (parseInt(size) * 0.0929).toFixed(1) : "—",
        TYPE:         ptype,
        TENURE:       purpose === "Sale" ? "Freehold" : "Leasehold",
        PURPOSE:      purpose,
        LISTING_REF:  ref,
        DESCRIPTION:  desc,
        LOCAL_AREA:   `Located in ${community || city}, offering easy access to key landmarks, retail, dining, and transport links.`,
        FEATURE_1: features[0], FEATURE_2: features[1],
        FEATURE_3: features[2], FEATURE_4: features[3],
        FEATURE_5: features[4], FEATURE_6: features[5],
        FEATURE_7: features[6], FEATURE_8: features[7],
        PHOTO_1:      images[0] || "",
        PHOTO_2:      images[1] || "",
        PHOTO_3:      images[2] || "",
        PHOTO_4:      images[3] || "",
        PHOTO_FLOORPLAN: floorplan,
        AGENT_PHONE:  "+971 4 409 7333",
        AGENT_EMAIL:  "info@betterhomes.ae",
        AGENT_NAME:   "Hamed Taheri",
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
