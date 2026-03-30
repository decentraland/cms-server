import { resolve } from 'path'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { Verbosity, instrumentHttpServerWithRequestLogger } from '@well-known-components/http-requests-logger-component'
import { createHttpTracerComponent } from '@well-known-components/http-tracer-component'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createTracerComponent } from '@well-known-components/tracer-component'
import {
  createServerComponent,
  createStatusCheckComponent,
  instrumentHttpServerWithPromClientRegistry
} from '@dcl/http-server'
import { createPgComponent } from '@dcl/pg-component'
import { createSchemaValidatorComponent } from '@dcl/schema-validator-component'
import { createTracedFetcherComponent } from '@dcl/traced-fetch-component'
import { createCmsDatabaseComponent } from './adapters/cms-db'
import { createContentfulComponent } from './adapters/contentful'
import { metricDeclarations } from './metrics'
import type { AppComponents, CmsConfig, GlobalContext } from './types'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const tracer = await createTracerComponent()
  const fetcher = await createTracedFetcherComponent({ tracer })
  const logs = await createLogComponent({ metrics, tracer })

  const server = await createServerComponent<GlobalContext>(
    { config, logs },
    {
      cors: {
        origin: [
          'https://decentraland.zone',
          'https://decentraland.today',
          'https://decentraland.org',
          'http://localhost:5173',
          'http://localhost:5174',
          /^https:\/\/[a-z0-9-]+-decentraland1\.vercel\.app$/,
          /^https:\/\/landing-site-[a-z0-9-]+\.vercel\.app$/,
          /^https:\/\/blog-site-[a-z0-9-]+\.vercel\.app$/
        ],
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Contentful-Topic', 'If-None-Match'],
        exposedHeaders: ['ETag', 'Content-Length'],
        maxAge: 86400
      }
    }
  )

  const statusChecks = await createStatusCheckComponent({ server, config })
  createHttpTracerComponent({ server, tracer })
  instrumentHttpServerWithRequestLogger({ server, logger: logs }, { verbosity: Verbosity.INFO })

  if (!metrics.registry) {
    throw new Error('Metrics registry is not initialized')
  }

  await instrumentHttpServerWithPromClientRegistry({ metrics, server, config, registry: metrics.registry })

  const schemaValidator = createSchemaValidatorComponent({ ensureJsonContentType: false })

  // CMS-specific configuration
  const cmsConfig: CmsConfig = {
    contentfulSpaceId: await config.requireString('CONTENTFUL_SPACE_ID'),
    contentfulEnvironmentId: await config.requireString('CONTENTFUL_ENVIRONMENT_ID'),
    contentfulAccessToken: await config.requireString('CONTENTFUL_ACCESS_TOKEN')
  }

  // Database (pg-component reads PG_COMPONENT_PSQL_* env vars and handles pool + migrations)
  const pg = await createPgComponent(
    { logs, config, metrics },
    {
      migration: {
        dir: resolve(__dirname, 'migrations'),
        migrationsTable: 'pgmigrations',
        ignorePattern: '.*\\.map',
        direction: 'up'
      }
    }
  )

  const cmsDb = createCmsDatabaseComponent({ pg, logs })

  // Contentful adapter
  const contentful = await createContentfulComponent({ cmsConfig, fetcher, logs })

  return {
    fetcher,
    config,
    logs,
    server,
    statusChecks,
    metrics,
    schemaValidator,
    cmsConfig,
    pg,
    cmsDb,
    contentful
  }
}
