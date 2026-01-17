import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { HeaderGenerator } from 'header-generator';

await Actor.init();

const input = await Actor.getInput() || {};
const {
    startUrl,
    location,
    propertyType = 'koop',
    minPrice,
    maxPrice,
    results_wanted = 20,
    max_pages = 10,
    proxyConfiguration
} = input;

// Build start URL
let initialUrl = startUrl;
if (!initialUrl) {
    const baseUrl = `https://www.funda.nl/en/zoeken/${propertyType}/`;
    const params = new URLSearchParams();
    if (location) params.set('selected_area', `["${location}"]`);
    if (minPrice) params.set('price', `"${minPrice}-${maxPrice || ''}"`);
    initialUrl = params.toString() ? `${baseUrl}?${params}` : baseUrl;
}

log.info(`Starting: ${initialUrl}, want ${results_wanted} results`);

const headerGenerator = new HeaderGenerator({
    browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 130 }],
    devices: ['desktop'],
    operatingSystems: ['windows'],
    locales: ['en-US'],
});

const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);
let pagesVisited = 0;
const collectedIds = new Set();

// Resolve Nuxt 3 flattened array references with circular reference protection
function resolve(data, val, seen = new Set()) {
    if (typeof val !== 'number' || val < 0 || val >= data.length) return val;
    if (seen.has(val)) return null;
    seen.add(val);

    const item = data[val];
    if (item === null || typeof item !== 'object') return item;

    if (Array.isArray(item)) {
        return item.map(i => resolve(data, i, new Set(seen)));
    }

    const res = {};
    for (const key in item) {
        res[key] = resolve(data, item[key], new Set(seen));
    }
    return res;
}

// Extract value from array or direct value
function getValue(val) {
    if (Array.isArray(val)) return val[0];
    return val;
}

// Build image URL from thumbnail_id (e.g., 223359004 -> https://cloud.funda.nl/valentina_media/223/359/004.jpg)
function buildImageUrl(thumbnailId) {
    const id = getValue(thumbnailId);
    if (!id) return null;

    const idStr = String(id).padStart(9, '0');
    return `https://cloud.funda.nl/valentina_media/${idStr.slice(0, 3)}/${idStr.slice(3, 6)}/${idStr.slice(6, 9)}.jpg`;
}

// Find actual property listings from Nuxt 3 data
// Property listings have: thumbnail_id, object_detail_page_relative_url, address
function extractListings(data) {
    const listings = [];

    for (let i = 0; i < data.length; i++) {
        const item = data[i];
        // Real property listings have thumbnail_id AND object_detail_page_relative_url
        if (item && typeof item === 'object' &&
            item.thumbnail_id !== undefined &&
            item.object_detail_page_relative_url !== undefined) {
            const resolved = resolve(data, i);
            if (resolved) listings.push(resolved);
        }
    }

    if (listings.length > 0) {
        log.info(`Found ${listings.length} property listings`);
        return listings;
    }

    return null;
}

const crawler = new CheerioCrawler({
    maxConcurrency: 5,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 30,
    useSessionPool: true,
    proxyConfiguration: proxyConfig,

    preNavigationHooks: [
        async ({ request }) => {
            request.headers = {
                ...headerGenerator.getHeaders(),
                'sec-ch-ua': '"Chromium";v="122", "Google Chrome";v="122"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            };
        },
    ],

    async requestHandler({ $, request }) {
        const title = $('title').text();
        if (title.includes('Access Denied') || title.includes('Captcha')) {
            log.error('BLOCKED!');
            return;
        }

        pagesVisited++;
        const nuxtDataScript = $('#__NUXT_DATA__').html();
        if (!nuxtDataScript) {
            log.warning('No __NUXT_DATA__');
            return;
        }

        const data = JSON.parse(nuxtDataScript);
        const listings = extractListings(data);

        if (!listings || listings.length === 0) {
            log.warning('No listings found');
            return;
        }

        let remaining = results_wanted - collectedIds.size;
        const itemsToPush = [];

        for (let i = 0; i < listings.length && remaining > 0; i++) {
            const listing = listings[i];

            // Extract ID from URL path
            const urlPath = listing.object_detail_page_relative_url || '';
            const urlIdMatch = urlPath.match(/\/(\d+)\/?$/);
            const propertyId = urlIdMatch ? urlIdMatch[1] : (listing.id || `${pagesVisited}-${i}`);

            if (collectedIds.has(propertyId)) continue;
            collectedIds.add(propertyId);

            // Build full URL
            let url = listing.object_detail_page_relative_url;
            if (url && !url.startsWith('http')) url = `https://www.funda.nl${url}`;

            // Extract address components
            const addr = listing.address || {};
            const streetName = addr.street_name || addr.street || '';
            const houseNumber = addr.house_number || '';
            const fullAddress = `${streetName} ${houseNumber}`.trim();

            // Extract price
            const priceObj = listing.price || {};
            const price = getValue(priceObj.selling_price) || getValue(priceObj.rental_price) || priceObj;

            itemsToPush.push({
                id: propertyId,
                address: fullAddress,
                postalCode: addr.postal_code,
                city: addr.city,
                municipality: addr.municipality,
                province: addr.province,
                neighbourhood: addr.neighbourhood,
                price: typeof price === 'number' ? price : null,
                priceCondition: priceObj.selling_price_condition,
                priceCurrency: "EUR",
                floorArea: getValue(listing.floor_area),
                plotArea: getValue(listing.plot_area),
                rooms: listing.number_of_rooms,
                bedrooms: listing.number_of_bedrooms,
                energyLabel: listing.energy_label,
                objectType: listing.object_type,
                constructionType: listing.construction_type,
                status: listing.status,
                publishDate: listing.publish_date,
                imageUrl: buildImageUrl(listing.thumbnail_id),
                url,
                scrapedAt: new Date().toISOString()
            });
            remaining--;
        }

        if (itemsToPush.length) {
            await Dataset.pushData(itemsToPush);
            log.info(`Page ${pagesVisited}: +${itemsToPush.length} (total: ${collectedIds.size}/${results_wanted})`);
        }

        // Pagination
        if (collectedIds.size < results_wanted && pagesVisited < max_pages) {
            const urlObj = new URL(request.url);
            const nextPage = parseInt(urlObj.searchParams.get('page') || '1') + 1;
            urlObj.searchParams.set('page', nextPage.toString());
            await crawler.addRequests([{ url: urlObj.toString() }]);
        }
    },

    failedRequestHandler({ request }, error) {
        log.error(`Failed: ${request.url}`);
    },
});

await crawler.run([initialUrl]);
log.info(`Done. Collected ${collectedIds.size} listings.`);
await Actor.exit();
