import { resolve } from 'path'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createFetchComponent } from '@well-known-components/fetch-component'
import { createLogComponent } from '@well-known-components/logger'
import { createTestMetricsComponent } from '@well-known-components/metrics'
import {
  createLocalFetchCompoment as createLocalFetchComponent,
  createRunner
} from '@well-known-components/test-helpers'
import { createServerComponent, createStatusCheckComponent } from '@dcl/http-server'
import { createPgComponent } from '@dcl/pg-component'
import { createSchemaValidatorComponent } from '@dcl/schema-validator-component'
import { createCmsDatabaseComponent } from '../src/adapters/cms-db'
import { createContentfulComponent } from '../src/adapters/contentful'
import { metricDeclarations } from '../src/metrics'
import { main } from '../src/service'
import type { GlobalContext, TestComponents } from '../src/types'

/**
 * Behaves like Jest "describe" function, used to describe a test for a
 * use case, it creates a whole new program and components to run an
 * isolated test.
 *
 * State is persistent within the steps of the test.
 */
export const test = createRunner<TestComponents>({
  main,
  initComponents
})

async function initComponents(): Promise<TestComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env.test'] })
  const metrics = createTestMetricsComponent(metricDeclarations)
  const logs = await createLogComponent({ metrics, config })

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

  const _statusChecks = await createStatusCheckComponent({ server, config })
  const fetcher = createFetchComponent()
  const schemaValidator = createSchemaValidatorComponent({ ensureJsonContentType: false })

  const cmsConfig = {
    contentfulSpaceId: await config.requireString('CONTENTFUL_SPACE_ID'),
    contentfulEnvironmentId: await config.requireString('CONTENTFUL_ENVIRONMENT_ID'),
    contentfulAccessToken: await config.requireString('CONTENTFUL_ACCESS_TOKEN')
  }

  const pg = await createPgComponent(
    { logs, config, metrics },
    {
      migration: {
        dir: resolve(__dirname, '../src/migrations'),
        migrationsTable: 'pgmigrations',
        ignorePattern: '.*\\.map',
        direction: 'up'
      }
    }
  )

  const cmsDb = createCmsDatabaseComponent({ pg, logs })
  const contentful = await createContentfulComponent({ cmsConfig, fetcher, logs })

  return {
    config,
    logs,
    server,
    metrics,
    fetcher,
    schemaValidator,
    cmsConfig,
    pg,
    cmsDb,
    contentful,
    localFetch: await createLocalFetchComponent(config)
  }
}
