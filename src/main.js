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
    if (seen.has(val)) return null; // Circular reference
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

// Find and resolve all listings from Nuxt 3 data
function extractListings(data) {
    log.info(`Searching ${data.length} elements for listings...`);

    for (let i = 0; i < data.length; i++) {
        const item = data[i];
        if (item && typeof item === 'object' && item.listings !== undefined) {
            log.info(`Found 'listings' key at index ${i}, value: ${item.listings}`);

            const listings = resolve(data, item.listings);
            log.info(`Resolved listings type: ${typeof listings}, isArray: ${Array.isArray(listings)}, length: ${listings?.length || 0}`);

            if (Array.isArray(listings) && listings.length > 0) {
                const first = listings[0];
                log.info(`First listing keys: ${first ? Object.keys(first).join(', ') : 'null'}`);

                // Return if it looks like property data
                if (first && typeof first === 'object') {
                    return listings;
                }
            }
        }
    }

    // Fallback: search for objects that look like listings directly
    log.info('Primary search failed, trying fallback...');
    const directListings = [];
    for (let i = 0; i < data.length; i++) {
        const item = data[i];
        if (item && typeof item === 'object' &&
            (item.object_detail_page_relative_url !== undefined ||
                item.floor_area !== undefined ||
                item.number_of_rooms !== undefined)) {
            const resolved = resolve(data, i);
            if (resolved) directListings.push(resolved);
        }
    }

    if (directListings.length > 0) {
        log.info(`Fallback found ${directListings.length} listings`);
        return directListings;
    }

    return null;
}

// Extract value from array or direct value (Nuxt stores single values as arrays)
function getValue(val) {
    if (Array.isArray(val)) return val[0];
    return val;
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

            // Extract ID from URL path or use internal id
            const urlPath = listing.object_detail_page_relative_url || '';
            const urlIdMatch = urlPath.match(/\/(\d+)\/?$/);
            const propertyId = urlIdMatch ? urlIdMatch[1] : (listing.id || `${pagesVisited}-${i}`);

            if (collectedIds.has(propertyId)) continue;
            collectedIds.add(propertyId);

            // Build full URL
            let url = listing.object_detail_page_relative_url;
            if (url && !url.startsWith('http')) url = `https://www.funda.nl${url}`;

            // Extract address components (Nuxt uses street_name not street)
            const addr = listing.address || {};
            const streetName = addr.street_name || addr.street || '';
            const houseNumber = addr.house_number || '';
            const fullAddress = `${streetName} ${houseNumber}`.trim();

            // Extract price (stored as array [299000])
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
