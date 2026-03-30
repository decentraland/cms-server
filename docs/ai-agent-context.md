# AI Agent Context

**Service Purpose:**

The CMS Server is a caching proxy for Decentraland's Contentful-based blog and CMS content. It receives webhook events from Contentful to keep a PostgreSQL cache in sync, and serves cached content to frontend clients with localization, pagination, filtering, and ETag support. It replaces an AWS Lambda that used S3 for caching.

**Key Capabilities:**

- Webhook ingestion for Contentful publish/unpublish events (blog posts, categories, authors, assets)
- Blog listing with filtering by category, author, and slug, with pagination and locale support
- Individual entry/asset retrieval with DB-first lookup and Contentful CDN fallback
- Bulk sync of all blog content from Contentful (rate-limited to once per hour)
- ETag generation and 304 Not Modified responses for conditional requests
- Asset URL rewriting from Contentful CDN to Decentraland CDN hostnames

**Communication Pattern:**

HTTP REST API. Contentful sends webhook POST requests. Frontend clients send GET requests for content. Admin clients send POST requests for sync and migration operations.

**Technology Stack:**

- Runtime: Node.js 24.x
- Language: TypeScript (strict mode)
- HTTP Framework: `@dcl/http-server` (WKC-based, with built-in CORS)
- Database: `@well-known-components/pg-component` (PostgreSQL with `node-pg-migrate`)
- Validation: `@dcl/schema-validator-component`
- Fetcher: `@dcl/traced-fetch-component` (HTTP client with distributed tracing)
- Testing: Jest 30 with `@well-known-components/test-helpers`, nock for HTTP mocking
- Architecture: Well-Known Components (WKC) pattern with adapters, logic, and controller layers

**External Dependencies:**

- Database: PostgreSQL (caches Contentful entries in dedicated blog tables + generic entry cache)
- Contentful CDN API: `https://cdn.contentful.com` (source of truth for CMS content)
- Decentraland CDN: Asset URLs are rewritten to `cms-images.decentraland.org`, `cms-videos.decentraland.org`, etc.

**Key Concepts:**

- **Blog Tables vs Generic Cache**: Blog content types (`blog_post`, `blog_category`, `blog_author`) have dedicated tables with denormalized columns for indexed filtering/sorting. All other entries/assets go to the generic `cms_entries` table.
- **Webhook Flow**: Contentful publishes an event -> POST `/webhook` -> controller validates auth + topic -> logic routes to blog table or generic cache.
- **Entry Retrieval**: GET entry -> check all DB tables (UNION ALL) -> if miss, fetch from Contentful CDN -> cache result -> localize fields -> return with ETag.
- **Localization**: Fields stored in Contentful's localized format (`{ "en-US": "value", "es": "valor" }`). The server extracts the requested locale with `en-US` fallback.
- **CORS**: Handled by `@dcl/http-server`'s built-in CORS middleware. Allowed origins include Decentraland domains and Vercel preview patterns.
- **Migrations**: Managed by `node-pg-migrate` via the pg-component. Run automatically on server startup.

**Database notes:**

- **Prepared statements**: Hot-path read queries use named prepared statements for query plan caching.
- **JSONB columns**: `slug` and `title` are stored as JSONB (localized format) with GIN indexes for jsonb_path_ops containment queries.
- **published_date_sort**: Extracted `en-US` date as `TIMESTAMPTZ` for B-tree index-friendly sorting.
- **Bulk sync uses transactions**: The `bulkUpsertBlogContent` method wraps batched INSERTs in a single transaction via `pg.withTransaction()`.
- **UNION ALL for entry lookup**: `findEntryContent` searches `cms_entries` + all 3 blog tables in a single query to find content regardless of storage location.
