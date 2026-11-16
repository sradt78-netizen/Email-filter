# OpenContact — Public Email Finder

A Vercel-ready Next.js app for discovering business and professional email addresses publicly published on websites. It uses Tavily Search for discovery, deduplicates addresses, checks syntax and domain mail routing (MX), and exports CSV.

## Responsible use and limitations

- This is not a Google account scraper. It searches public web results and inspects public pages only.
- The crawler checks robots.txt before fetching, rejects local/private IP destinations, blocks redirects, limits response size, and uses request timeouts.
- An MX record confirms domain mail routing, not an individual mailbox, deliverability, or consent.
- Search coverage is limited by provider quotas, crawl permissions, and the per-search page cap. A requested result count is a maximum, not a guarantee.
- Use contact data in compliance with applicable privacy and anti-spam laws. Do not use the app for unsolicited bulk messaging.

## Run locally

```bash
npm install
cp .env.example .env.local
# Add TAVILY_API_KEY to .env.local
npm run dev
```

## Deploy to Vercel

1. Import this GitHub repository into Vercel.
2. Add `TAVILY_API_KEY` as an encrypted environment variable.
3. Optionally set `MAX_PAGES_PER_SEARCH` (default 12, maximum 20).
4. Redeploy after adding environment variables.

Create a Tavily key at https://app.tavily.com/.

## API

`POST /api/search`

```json
{"query":"accounting firms in Manchester","scope":"both","limit":100}
```

`scope` is `both`, `business`, or `professional`. `limit` is an integer from 1 to 500.
