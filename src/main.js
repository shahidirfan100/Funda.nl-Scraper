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

        let items = [];

        // PRIORITY 1: Try __NUXT_DATA__
        const nuxtDataScript = $('#__NUXT_DATA__').html();
        if (nuxtDataScript) {
            try {
                const data = JSON.parse(nuxtDataScript);

                for (const item of data) {
                    if (item && typeof item === 'object' && Array.isArray(item.listings) && item.listings.length > 0) {
                        items = item.listings;
                        log.info(`Extracted ${items.length} from __NUXT_DATA__`);
                        break;
                    }
                }
            } catch (e) {
                log.warning(`__NUXT_DATA__ parse failed: ${e.message}`);
            }
        }

        // PRIORITY 1b: Try JSON-LD as fallback
        if (items.length === 0) {
            $('script[type="application/ld+json"]').each((_, el) => {
                try {
                    const json = JSON.parse($(el).text());
                    if (json['@type'] === 'ItemList' && json.itemListElement) {
                        items = json.itemListElement.map(item => ({
                            url: item.url,
                            address: item.name,
                        }));
                        log.info(`Extracted ${items.length} from JSON-LD ItemList`);
                    }
                } catch { }
            });
        }

        // No data extracted - save debug HTML
        if (items.length === 0) {
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
        for (const listing of items) {
            if (remaining <= 0) break;

            const id = listing.globalId || listing.id || listing.url;
            if (collectedIds.has(id)) continue;
            collectedIds.add(id);

            const item = {
                id: listing.globalId || listing.id,
                address: listing.address,
                postalCode: listing.zipCode,
                city: listing.city,
                price: listing.price?.value || listing.price,
                priceCurrency: "EUR",
                floorArea: listing.floorArea,
                plotArea: listing.plotArea,
                rooms: listing.rooms,
                url: listing.url,
                imageUrl: listing.images?.[0]?.url || listing.mainImage?.url || listing.photo,
                scrapedAt: new Date().toISOString()
            };

            if (item.url && !item.url.startsWith('http')) {
                item.url = `https://www.funda.nl${item.url}`;
            }

            itemsToPush.push(item);
            remaining--;
        }

        await Dataset.pushData(itemsToPush);
        log.info(`Pushed ${itemsToPush.length} listings. Total: ${collectedIds.size}/${results_wanted}`);

        // Pagination
        if (collectedIds.size < results_wanted && pagesVisited < max_pages && items.length > 0) {
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
