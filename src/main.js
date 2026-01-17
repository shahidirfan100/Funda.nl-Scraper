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
    collectDetails = false,
    results_wanted = 20,
    max_pages = 10,
    proxyConfiguration
} = input;

// Build start URL from parameters if not provided directly
let initialUrl = startUrl;
if (!initialUrl) {
    const baseUrl = `https://www.funda.nl/en/zoeken/${propertyType}/`;
    const params = new URLSearchParams();

    if (location) {
        params.set('selected_area', `["${location}"]`);
    }
    if (minPrice) {
        params.set('price', `"${minPrice}-${maxPrice || ''}"`);
    }

    initialUrl = params.toString() ? `${baseUrl}?${params}` : baseUrl;
}

log.info(`Starting scraper with URL: ${initialUrl}`);
log.info(`Results wanted: ${results_wanted}, Max pages: ${max_pages}`);

const headerGenerator = new HeaderGenerator({
    browsers: [
        { name: 'chrome', minVersion: 120, maxVersion: 130 },
        { name: 'firefox', minVersion: 115, maxVersion: 125 }
    ],
    devices: ['desktop'],
    operatingSystems: ['windows', 'macos'],
    locales: ['en-US'],
});

// Configure proxy
const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);

let pagesVisited = 0;
const collectedIds = new Set();

/**
 * Resolve Nuxt 3 flattened array references
 * Nuxt 3 stores data as a flat array where object properties are indices to other array elements
 */
function resolveNuxtValue(data, val, depth = 0) {
    if (depth > 5) return val; // Prevent infinite loops

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

/**
 * Find the search results object in Nuxt 3 data
 */
function findListingsInNuxtData(data) {
    // Search for object containing 'listings' key
    for (let i = 0; i < data.length; i++) {
        const item = data[i];
        if (item && typeof item === 'object' && item.listings !== undefined) {
            log.info(`Found listings reference at index ${i}`);

            // listings is an index pointing to an array
            const listingsArrayIndex = item.listings;
            const listingsArray = data[listingsArrayIndex];

            if (Array.isArray(listingsArray)) {
                log.info(`Listings array at index ${listingsArrayIndex} has ${listingsArray.length} items`);

                // Each element is an index to a listing object
                const resolvedListings = listingsArray.map(idx => {
                    const listingObj = data[idx];
                    if (listingObj && typeof listingObj === 'object') {
                        // Resolve all properties
                        const resolved = {};
                        for (const key in listingObj) {
                            resolved[key] = resolveNuxtValue(data, listingObj[key], 0);
                        }
                        return resolved;
                    }
                    return null;
                }).filter(Boolean);

                return resolvedListings;
            }
        }
    }

    // Fallback: Find objects that look like listings (have address and price)
    log.info('Searching for listing objects directly...');
    const directListings = [];
    for (let i = 0; i < data.length; i++) {
        const item = data[i];
        if (item && typeof item === 'object' &&
            (item.address !== undefined || item.floor_area !== undefined) &&
            item.price !== undefined) {
            const resolved = {};
            for (const key in item) {
                resolved[key] = resolveNuxtValue(data, item[key], 0);
            }
            directListings.push(resolved);
        }
    }

    if (directListings.length > 0) {
        log.info(`Found ${directListings.length} listing objects directly`);
        return directListings;
    }

    return null;
}

const crawler = new CheerioCrawler({
    maxConcurrency: 3,
    maxRequestRetries: 5,
    requestHandlerTimeoutSecs: 60,
    useSessionPool: true,
    sessionPoolOptions: {
        maxPoolSize: 50,
        sessionOptions: {
            maxUsageCount: 10,
            maxErrorScore: 3,
        },
    },
    proxyConfiguration: proxyConfig,

    preNavigationHooks: [
        async ({ request }) => {
            const headers = headerGenerator.getHeaders();
            request.headers = {
                ...headers,
                'sec-ch-ua': '"Chromium";v="122", "Google Chrome";v="122"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'none',
                'sec-fetch-user': '?1',
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'accept-language': 'en-US,en;q=0.9',
            };

            // Human-like delay (1-3 seconds)
            const delay = 1000 + Math.random() * 2000;
            await new Promise(r => setTimeout(r, delay));
        },
    ],

    async requestHandler({ $, request, body }) {
        const { url } = request;
        const isDetailPage = request.userData?.isDetail;

        // Debug logging
        log.info(`Response length: ${body?.length || $.html().length}`);

        // Blocking detection
        const title = $('title').text();
        log.info(`Page title: ${title}`);

        if (title.includes('Access Denied') ||
            title.includes('Captcha') ||
            title.includes('Robot') ||
            title.includes('Blocked')) {
            log.error('BLOCKED! Need better stealth or proxies');
            await Actor.setValue('debug-blocked', $.html(), { contentType: 'text/html' });
            return;
        }

        if (isDetailPage) {
            log.info(`Processing detail page: ${url}`);
            return;
        }

        pagesVisited++;
        log.info(`Processing listing page ${pagesVisited}/${max_pages}: ${url}`);

        let listings = [];

        // PRIORITY 1: Try __NUXT_DATA__ (Nuxt 3 format)
        const nuxtDataScript = $('#__NUXT_DATA__').html();
        if (nuxtDataScript) {
            try {
                const data = JSON.parse(nuxtDataScript);
                log.info(`Parsed __NUXT_DATA__ with ${data.length} elements`);

                listings = findListingsInNuxtData(data);

                if (listings && listings.length > 0) {
                    log.info(`Extracted ${listings.length} listings from __NUXT_DATA__`);
                }
            } catch (e) {
                log.warning(`__NUXT_DATA__ parse failed: ${e.message}`);
            }
        }

        // PRIORITY 1b: Try JSON-LD as fallback
        if (!listings || listings.length === 0) {
            $('script[type="application/ld+json"]').each((_, el) => {
                try {
                    const json = JSON.parse($(el).text());
                    if (json['@type'] === 'ItemList' && json.itemListElement) {
                        listings = json.itemListElement.map(item => ({
                            url: item.url,
                            address: item.name,
                        }));
                        log.info(`Extracted ${listings.length} from JSON-LD ItemList`);
                    }
                } catch { }
            });
        }

        // No data extracted - save debug HTML
        if (!listings || listings.length === 0) {
            log.warning('No data extracted! Saving debug HTML...');
            await Actor.setValue(`debug-page-${pagesVisited}`, $.html(), { contentType: 'text/html' });
            return;
        }

        // Process and deduplicate items
        const currentCount = collectedIds.size;
        let remaining = results_wanted - currentCount;

        if (remaining <= 0) {
            log.info('Reached desired results count, stopping...');
            return;
        }

        const itemsToPush = [];
        for (const listing of listings) {
            if (remaining <= 0) break;

            // Extract ID from various possible locations
            const id = listing.id || listing.globalId || listing.object_detail_page_relative_url;
            if (!id || collectedIds.has(id)) continue;
            collectedIds.add(id);

            // Build normalized output object
            const item = {
                id: listing.id || listing.globalId,
                address: typeof listing.address === 'object'
                    ? `${listing.address.street || ''} ${listing.address.house_number || ''}`.trim()
                    : listing.address,
                postalCode: listing.address?.postal_code || listing.zipCode,
                city: listing.address?.city || listing.city,
                price: typeof listing.price === 'object'
                    ? listing.price.selling_price || listing.price.value
                    : listing.price,
                priceCurrency: "EUR",
                floorArea: listing.floor_area || listing.floorArea,
                plotArea: listing.plot_area || listing.plotArea,
                rooms: listing.number_of_rooms || listing.rooms,
                bedrooms: listing.number_of_bedrooms,
                url: listing.object_detail_page_relative_url || listing.url,
                imageUrl: listing.images?.[0]?.url || listing.mainImage?.url || listing.photo,
                energyLabel: listing.energy_label,
                scrapedAt: new Date().toISOString()
            };

            // Normalize URL
            if (item.url && !item.url.startsWith('http')) {
                item.url = `https://www.funda.nl${item.url}`;
            }

            itemsToPush.push(item);
            remaining--;
        }

        if (itemsToPush.length > 0) {
            await Dataset.pushData(itemsToPush);
            log.info(`Pushed ${itemsToPush.length} listings. Total: ${collectedIds.size}/${results_wanted}`);
        }

        // Pagination
        if (collectedIds.size < results_wanted && pagesVisited < max_pages && listings.length > 0) {
            const urlObj = new URL(url);
            const currentPage = parseInt(urlObj.searchParams.get('page') || '1');
            const nextPage = currentPage + 1;
            urlObj.searchParams.set('page', nextPage.toString());

            log.info(`Enqueueing page ${nextPage}`);
            await crawler.addRequests([{ url: urlObj.toString() }]);
        }
    },

    failedRequestHandler({ request }, error) {
        log.error(`Request failed: ${request.url} - ${error.message}`);
    },
});

await crawler.run([initialUrl]);

log.info(`Scraping complete. Collected ${collectedIds.size} listings.`);
await Actor.exit();
