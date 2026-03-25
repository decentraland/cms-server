# {server-name} Server

[![Coverage Status](https://coveralls.io/repos/github/{org-name}/{repo-name}/badge.svg?branch=main)](https://coveralls.io/github/{org-name}/{repo-name}?branch=main)

<!-- A brief description of the purpose of the service -->

This server interacts with X, Y and Z server in order to provider users with F.

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

<!-- List of features the server has -->

- **Feature 1**: Provides Y functionality to the users.

## Dependencies & Related Services

<!-- List any services this server depends on or interacts with -->

This service interacts with the following services:

- **[Service Name 1](link-to-service-repo)**: Description of interaction
- **[Service Name 2](link-to-service-repo)**: Description of interaction

External dependencies:

- List any external APIs or third-party services
- Database systems
- Message queues or event streams

## API Documentation

The API is fully documented using the [OpenAPI standard](https://swagger.io/specification/). It's schema is located at [docs/openapi.yaml](docs/openapi.yaml).

## Database

### Schema

<!-- Remove this section if the service does not have a database -->

See [docs/database-schemas.md](docs/database-schemas.md) for detailed schema, column definitions, and relationships

### Migrations

<!-- Remove this section if the service does not have a database -->

The service uses `node-pg-migrate` for database migrations. These migrations are located in `src/migrations/`. The service automatically runs the migrations when starting up.

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

- **Node.js**: Version 24.x or higher (LTS recommended)
- **Yarn**: Version 1.22.x or higher
- **Docker**: For containerized deployment

<!-- List any other dependencies that are required to run the service -->

### Installation

1. Clone the repository:

```bash
git clone https://github.com/{org-name}/{repo-name}.git
cd {repo-name}
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

The service uses environment variables for configuration.
Create a `.env` file in the root directory containing the environment variables for the service to run.
Use the `.env.default` variables as an example.

### Running the Service

#### Setting up the environment

In order to successfully run this server, external dependencies such as databases, memory storages and such must be provided.
To do so, this repository provides you with a `docker-compose` file for that purpose. In order to get the environment set up, run:

```bash
docker-compose up
```

#### Running in development mode

To run the service in development mode:

```bash
yarn start:dev
```

## Testing

This service includes comprehensive test coverage with both unit and integration tests.

### Running Tests

Run all tests with coverage:

```bash
yarn test
```

Run tests in watch mode:

```bash
yarn test --watch
```

Run only unit tests:

```bash
yarn test test/unit
```

Run only integration tests:

```bash
yarn test test/integration
```

### Test Structure

- **Unit Tests** (`test/unit/`): Test individual components and functions in isolation
- **Integration Tests** (`test/integration/`): Test the complete request/response cycle

For detailed testing guidelines and standards, refer to our [Testing Standards](https://github.com/decentraland/docs/tree/main/development-standards/testing-standards) documentation.

## AI Agent Context

For detailed AI Agent context, see [docs/ai-agent-context.md](docs/ai-agent-context.md).

---

**Note**: Remember to replace all placeholders in this README (e.g., `{server-name}`, `{org-name}`, `{repo-name}`, `{service-name}`, links to documentation) with actual values specific to your service.
