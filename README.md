# Funda.nl Scraper

Scrape real estate listings from Funda.nl, the largest property platform in the Netherlands. Extract comprehensive property data including prices, locations, and specifications.

---

## Features

- **Flexible Search**: Use a direct URL or search by location and property type
- **Price Filters**: Set minimum and maximum price ranges
- **Fast Extraction**: Uses optimized methods for quick data retrieval
- **Pagination**: Automatically navigates through multiple pages
- **Stealth Protection**: Built-in anti-blocking mechanisms
- **Proxy Support**: Full Apify Proxy integration

---

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `startUrl` | String | - | Direct Funda.nl search URL to scrape |
| `location` | String | - | City or area (e.g., 'amsterdam', 'rotterdam') |
| `propertyType` | String | `koop` | Type: `koop` (sale) or `huur` (rent) |
| `minPrice` | Integer | - | Minimum price filter (€) |
| `maxPrice` | Integer | - | Maximum price filter (€) |
| `collectDetails` | Boolean | `false` | Scrape detail pages for full info |
| `results_wanted` | Integer | `20` | Maximum listings to collect |
| `max_pages` | Integer | `10` | Maximum pages to visit |
| `proxyConfiguration` | Object | Residential | Apify Proxy settings |

---

## Output Data

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Unique listing identifier |
| `address` | String | Property address |
| `postalCode` | String | Postal code |
| `city` | String | City name |
| `price` | Number | Asking price (€) |
| `priceCurrency` | String | Currency (EUR) |
| `floorArea` | Number | Living area (m²) |
| `plotArea` | Number | Plot size (m²) |
| `rooms` | Number | Number of rooms |
| `url` | String | Listing URL |
| `imageUrl` | String | Main image URL |

---

## Usage Examples

### Search by URL
```json
{
    "startUrl": "https://www.funda.nl/en/zoeken/koop/",
    "results_wanted": 50
}
```

### Search by Location
```json
{
    "location": "amsterdam",
    "propertyType": "koop",
    "minPrice": 200000,
    "maxPrice": 500000,
    "results_wanted": 100
}
```

### Rental Properties
```json
{
    "location": "rotterdam",
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
    "scrapedAt": "2023-10-27T10:00:00.000Z"
}
```

---

## Use Cases

- **Market Analysis**: Track pricing trends across Dutch cities
- **Investment Research**: Identify opportunities and monitor listings
- **Competitor Monitoring**: Analyze real estate agency portfolios
- **Property Search**: Aggregate listings matching specific criteria

---

## Tips

- Use the Funda.nl website to apply filters, then copy the URL to `startUrl`
- Set `max_pages` to limit scraping time and costs
- Use residential proxies for best reliability

---

## Legal Notice

This scraper is for educational and analytical purposes. Respect Funda.nl's terms of service.