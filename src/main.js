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

// Resolve Nuxt 3 flattened array references
function resolveNuxtValue(data, val, depth = 0) {
    if (depth > 5) return val;
    if (typeof val === 'number' && val >= 0 && val < data.length) {
        const target = data[val];
        if (Array.isArray(target)) {
            return target.map(i => resolveNuxtValue(data, i, depth + 1));
        } else if (target && typeof target === 'object') {
            const resolved = {};
            for (const key in target) {
                resolved[key] = resolveNuxtValue(data, target[key], depth + 1);
            }
            return resolved;
        }
        return target;
    }
    return val;
}

// Find listings in Nuxt 3 data
function findListingsInNuxtData(data) {
    for (let i = 0; i < data.length; i++) {
        const item = data[i];
        if (item && typeof item === 'object' && item.listings !== undefined) {
            const listingsArray = data[item.listings];
            if (Array.isArray(listingsArray)) {
                return listingsArray.map(idx => {
                    const obj = data[idx];
                    if (obj && typeof obj === 'object') {
                        const resolved = {};
                        for (const key in obj) {
                            resolved[key] = resolveNuxtValue(data, obj[key], 0);
                        }
                        return resolved;
                    }
                    return null;
                }).filter(Boolean);
            }
        }
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
        const listings = findListingsInNuxtData(data);

        if (!listings || listings.length === 0) {
            log.warning('No listings found');
            return;
        }

        let remaining = results_wanted - collectedIds.size;
        const itemsToPush = [];

        for (let i = 0; i < listings.length && remaining > 0; i++) {
            const listing = listings[i];
            const id = listing.id || listing.globalId || listing.object_detail_page_relative_url || `${pagesVisited}-${i}`;
            if (collectedIds.has(id)) continue;
            collectedIds.add(id);

            let url = listing.object_detail_page_relative_url || listing.url;
            if (url && !url.startsWith('http')) url = `https://www.funda.nl${url}`;

            itemsToPush.push({
                id: listing.id || listing.globalId || id,
                address: typeof listing.address === 'object'
                    ? `${listing.address.street || ''} ${listing.address.house_number || ''}`.trim()
                    : listing.address,
                postalCode: listing.address?.postal_code,
                city: listing.address?.city,
                price: typeof listing.price === 'object' ? listing.price.selling_price : listing.price,
                priceCurrency: "EUR",
                floorArea: listing.floor_area,
                plotArea: listing.plot_area,
                rooms: listing.number_of_rooms,
                bedrooms: listing.number_of_bedrooms,
                url,
                imageUrl: listing.images?.[0]?.url || listing.photo,
                energyLabel: listing.energy_label,
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
