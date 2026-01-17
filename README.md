# Funda.nl Scraper

Extract comprehensive real estate data from Funda.nl, the Netherlands' largest property platform. Collect property listings including addresses, prices, specifications, and images at scale. Perfect for market research, investment analysis, and property monitoring.

## Features

- **Flexible Search** — Use direct URLs or search by location and property type
- **Price Filtering** — Set minimum and maximum price ranges
- **Automatic Pagination** — Collects results across multiple pages
- **Proxy Support** — Full Apify Proxy integration for reliable scraping
- **Resilient Extraction** — Built-in error handling and retry logic

## Use Cases

### Real Estate Market Analysis
Track pricing trends across Dutch cities and neighborhoods. Identify hotspots, compare average prices, and monitor market fluctuations over time.

### Investment Research
Discover investment opportunities by analyzing property values, locations, and specifications. Build datasets to inform buying decisions.

### Competitor Monitoring
Analyze real estate agency portfolios and pricing strategies. Track new listings from specific sellers or regions.

### Personal Property Search
Aggregate listings matching your specific criteria. Filter by location, price range, and property type to find your ideal home.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | — | Direct Funda.nl search URL to scrape |
| `location` | String | No | — | City or area (e.g., 'amsterdam', 'rotterdam') |
| `propertyType` | String | No | `"koop"` | Property type: `koop` (sale) or `huur` (rent) |
| `minPrice` | Integer | No | — | Minimum price filter (€) |
| `maxPrice` | Integer | No | — | Maximum price filter (€) |
| `collectDetails` | Boolean | No | `false` | Scrape detail pages for full information |
| `results_wanted` | Integer | No | `20` | Maximum number of listings to collect |
| `max_pages` | Integer | No | `10` | Maximum pages to visit |
| `proxyConfiguration` | Object | No | Residential | Apify Proxy configuration |

---

## Output Data

Each item in the dataset contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Unique listing identifier |
| `address` | String | Property address |
| `postalCode` | String | Postal code |
| `city` | String | City name |
| `price` | Number | Asking price (€) |
| `priceCurrency` | String | Currency code (EUR) |
| `floorArea` | Number | Living area in square meters |
| `plotArea` | Number | Plot size in square meters |
| `rooms` | Number | Number of rooms |
| `url` | String | Direct link to listing |
| `imageUrl` | String | Main property image URL |
| `scrapedAt` | String | Timestamp of extraction |

---

## Usage Examples

### Basic Extraction

Extract listings from the default search page:

```json
{
    "startUrl": "https://www.funda.nl/en/zoeken/koop/",
    "results_wanted": 50
}
```

### Location-Based Search

Search for properties in a specific city:

```json
{
    "location": "amsterdam",
    "propertyType": "koop",
    "results_wanted": 100
}
```

### Price Range Filtering

Filter properties by price range:

```json
{
    "location": "rotterdam",
    "minPrice": 200000,
    "maxPrice": 500000,
    "results_wanted": 50
}
```

### Rental Properties

Search for rental listings:

```json
{
    "location": "utrecht",
    "propertyType": "huur",
    "results_wanted": 30
}
```

---

## Sample Output

```json
{
    "id": "43487654",
    "address": "Keizersgracht 123",
    "postalCode": "1015 CJ",
    "city": "Amsterdam",
    "price": 850000,
    "priceCurrency": "EUR",
    "floorArea": 120,
    "plotArea": 0,
    "rooms": 4,
    "url": "https://www.funda.nl/en/koop/amsterdam/huis-43487654-keizersgracht-123/",
    "imageUrl": "https://cloud.funda.nl/valentina_media/123/456/789.jpg",
    "scrapedAt": "2024-01-17T10:00:00.000Z"
}
```

---

## Tips for Best Results

### Choose Working URLs
- Use the Funda.nl website to apply filters, then copy the resulting URL
- Verify URLs are accessible before running
- Start with popular search pages for testing

### Optimize Collection Size
- Start small for testing (20-50 results)
- Increase `results_wanted` for production runs
- Use `max_pages` to control run duration

### Proxy Configuration
- Residential proxies are recommended for reliability
- Enable Apify Proxy for best performance

```json
{
    "proxyConfiguration": {
        "useApifyProxy": true,
        "apifyProxyGroups": ["RESIDENTIAL"]
    }
}
```

---

## Integrations

Connect your data with:

- **Google Sheets** — Export for analysis and visualization
- **Airtable** — Build searchable property databases
- **Slack** — Get notifications for new listings
- **Webhooks** — Send data to custom endpoints
- **Make** — Create automated workflows
- **Zapier** — Trigger actions on new data

### Export Formats

- **JSON** — For developers and APIs
- **CSV** — For spreadsheet analysis
- **Excel** — For business reporting
- **XML** — For system integrations

---

## Frequently Asked Questions

### How many listings can I collect?
You can collect all available listings from search results. The practical limit depends on the number of results matching your criteria.

### Can I filter by specific criteria?
Yes, use the Funda.nl website to apply filters, then copy the URL to `startUrl`. Alternatively, use `location`, `propertyType`, and price parameters.

### What if some fields are missing?
Some fields may be empty if the listing doesn't include that information. Common missing fields include plot area for apartments.

### Does it work for rental properties?
Yes, set `propertyType` to `"huur"` or use a rental search URL.

### How often can I run the scraper?
You can schedule runs at any interval. Consider daily or weekly runs for market monitoring.

---

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/schedules)

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with website terms of service and applicable laws. Use data responsibly and respect rate limits.