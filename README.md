# CMS Server

This server acts as a caching proxy and content management layer for Decentraland's blog and CMS content powered by Contentful. It stores Contentful entries in PostgreSQL for fast, indexed querying and serves them to frontend clients with localization, pagination, and ETag-based conditional responses.

## Table of Contents

- [Features](#features)
- [Dependencies & Related Services](#dependencies--related-services)
- [API Documentation](#api-documentation)
- [Database](#database)
  - [Schema](#schema)
  - [Migrations](#migrations)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [Running the Service](#running-the-service)
- [Testing](#testing)
  - [Running Tests](#running-tests)
  - [Test Structure](#test-structure)
- [AI Agent Context](#ai-agent-context)

## Features

- **Blog Listing**: Paginated, filterable listing of blog posts, categories, and authors with locale support.
- **Entry Retrieval**: Individual entry/asset lookup with DB-first strategy and Contentful CDN fallback.
- **Webhook Processing**: Receives Contentful publish/unpublish webhooks to keep the database in sync.
- **Bulk Sync**: Full re-sync of all blog content from Contentful, rate-limited to once per hour.
- **ETag / 304 Support**: Generates ETags for cached entries and returns 304 Not Modified when appropriate.
- **Asset URL Rewriting**: Rewrites Contentful CDN URLs to Decentraland's CDN hostnames (`cms-images.decentraland.org`, etc.).
- **Localization**: Supports `en-US`, `es`, and `zh` locales with automatic field extraction and fallback.
- **CORS**: Configured for Decentraland domains and Vercel preview deployments.

## Dependencies & Related Services

This service interacts with the following:

- **[Contentful CDN API](https://www.contentful.com/developers/docs/references/content-delivery-api/)**: Source of truth for CMS content. The server fetches entries on cache miss and receives webhook events.
- **PostgreSQL**: Caches Contentful content with dedicated blog tables for indexed filtering and sorting.

## API Documentation

The API is fully documented using the [OpenAPI standard](https://swagger.io/specification/). Its schema is located at [docs/openapi.yaml](docs/openapi.yaml).

## Database

### Schema

See [docs/database-schemas.md](docs/database-schemas.md) for detailed schema, column definitions, and relationships.

### Migrations

The service uses `node-pg-migrate` for database migrations. These migrations are located in `src/migrations/`. The service automatically runs the migrations when starting up via the pg-component.

#### Create a new migration

Migrations are created by running the create command:

```bash
yarn migrate create name-of-the-migration
```

This will result in the creation of a migration file inside of the `src/migrations/` directory. This migration file MUST contain the migration set up and rollback procedures.

#### Manually applying migrations

If required, these migrations can be run manually.

To run them manually:

```bash
yarn migrate up
```

To rollback them manually:

```bash
yarn migrate down
```

## Getting Started

### Prerequisites

Before running this service, ensure you have the following installed:

- **Node.js**: Version 20.x or higher (LTS recommended)
- **Yarn**: Version 1.22.x or higher
- **Docker**: For the PostgreSQL database

### Installation

1. Clone the repository:

```bash
git clone https://github.com/decentraland/cms-server.git
cd cms-server
```

2. Install dependencies:

```bash
yarn install
```

3. Build the project:

```bash
yarn build
```

### Configuration

The service uses environment variables for configuration. Create a `.env` file in the root directory with the following variables (see `.env.default` for defaults):

| Variable | Description | Required |
|---|---|---|
| `CONTENTFUL_SPACE_ID` | Contentful space ID | Yes |
| `CONTENTFUL_ENVIRONMENT_ID` | Contentful environment (e.g. `master`) | Yes |
| `CONTENTFUL_ACCESS_TOKEN` | Contentful CDN access token | Yes |
| `PG_COMPONENT_PSQL_CONNECTION_STRING` | Full PostgreSQL connection URI | Yes (or individual vars below) |
| `PG_COMPONENT_PSQL_HOST` | PostgreSQL host | If no connection string |
| `PG_COMPONENT_PSQL_PORT` | PostgreSQL port (default: 5432) | If no connection string |
| `PG_COMPONENT_PSQL_DATABASE` | PostgreSQL database name | If no connection string |
| `PG_COMPONENT_PSQL_USER` | PostgreSQL user | If no connection string |
| `PG_COMPONENT_PSQL_PASSWORD` | PostgreSQL password | If no connection string |
| `HTTP_SERVER_PORT` | Server port (default: 3000) | No |
| `HTTP_SERVER_HOST` | Server host (default: 0.0.0.0) | No |

### Running the Service

#### Setting up the environment

Start the PostgreSQL database:

```bash
docker compose up -d postgres
```

#### Running in development mode

```bash
yarn start:dev
```

The server will start on port 3000 (or the configured `HTTP_SERVER_PORT`). Migrations run automatically on startup.

## Testing

This service includes comprehensive test coverage with both unit and integration tests.

### Running Tests

Run all tests with coverage:

```bash
yarn test
```

Run only unit tests:

```bash
yarn test:unit
```

Run only integration tests (requires PostgreSQL running):

```bash
yarn test:integration
```

### Test Structure

- **Unit Tests** (`test/unit/`): Test individual components and functions in isolation.
- **Integration Tests** (`test/integration/`): Test the complete request/response cycle against a real PostgreSQL database with the full WKC server stack. Covers webhooks, blog listing, entry retrieval, sync, and CORS.

For detailed testing guidelines and standards, refer to our [Testing Standards](https://github.com/decentraland/docs/tree/main/development-standards/testing-standards) documentation.

## AI Agent Context

For detailed AI Agent context, see [docs/ai-agent-context.md](docs/ai-agent-context.md).
