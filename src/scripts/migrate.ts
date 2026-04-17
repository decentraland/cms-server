/**
 * One-time migration script: copies all CMS content from S3 into PostgreSQL.
 *
 * Usage:
 *   npx ts-node src/scripts/migrate.ts
 *
 * Required environment variables:
 *   AWS_REGION                - AWS region (e.g. us-east-1)
 *   S3_BUCKET                 - Source S3 bucket name
 *   CONTENTFUL_SPACE_ID       - Contentful space ID (used as the S3 key prefix)
 *   CONTENTFUL_ENVIRONMENT_ID - Contentful environment (e.g. master)
 *   PG_COMPONENT_PSQL_CONNECTION_STRING - PostgreSQL connection string
 *
 * Optional environment variables:
 *   AWS_ACCESS_KEY_ID         - AWS access key (falls back to default credential chain)
 *   AWS_SECRET_ACCESS_KEY     - AWS secret key (falls back to default credential chain)
 *   AWS_SESSION_TOKEN         - AWS session token (for temporary credentials)
 */

import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { Client } from 'pg'

// --- Config ---

const BUCKET = requiredEnv('S3_BUCKET')
const SPACE = requiredEnv('CONTENTFUL_SPACE_ID')
const ENVIRONMENT = requiredEnv('CONTENTFUL_ENVIRONMENT_ID')

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {})
        }
      }
    : {})
})

const pg = new Client({ connectionString: requiredEnv('PG_COMPONENT_PSQL_CONNECTION_STRING') })

// --- Main ---

async function main() {
  await pg.connect()
  console.log('Connected to PostgreSQL')

  const stats = { entries: 0, assets: 0, posts: 0, categories: 0, authors: 0, skipped: 0, errors: 0 }

  // 1. Migrate blog catalogs (posts, categories, authors)
  await migrateBlogCatalog('posts', 'blog_post', stats)
  await migrateBlogCatalog('categories', 'blog_category', stats)
  await migrateBlogCatalog('authors', 'blog_author', stats)

  // 2. Migrate individual entries not already covered by catalogs
  const migratedEntryIds = new Set<string>()

  const catalogRes = await pg.query(`SELECT id FROM cms_entries WHERE space = $1 AND environment = $2`, [
    SPACE,
    ENVIRONMENT
  ])
  for (const row of catalogRes.rows) {
    migratedEntryIds.add(row.id)
  }
  console.log(`\n${migratedEntryIds.size} entries already in DB from catalogs`)

  // Migrate entries/
  const entriesPrefix = `spaces/${SPACE}/environments/${ENVIRONMENT}/entries/`
  await migrateS3Objects(entriesPrefix, 'Entry', migratedEntryIds, stats)

  // Migrate assets/
  const assetsPrefix = `spaces/${SPACE}/environments/${ENVIRONMENT}/assets/`
  await migrateS3Objects(assetsPrefix, 'Asset', migratedEntryIds, stats)

  // 3. Migrate last-sync metadata
  await migrateLastSync(stats)

  await pg.end()

  console.log('\n════════════════════════════════════════')
  console.log('Migration complete!')
  console.log(`  Blog posts:    ${stats.posts}`)
  console.log(`  Categories:    ${stats.categories}`)
  console.log(`  Authors:       ${stats.authors}`)
  console.log(`  Entries:       ${stats.entries}`)
  console.log(`  Assets:        ${stats.assets}`)
  console.log(`  Skipped:       ${stats.skipped}`)
  console.log(`  Errors:        ${stats.errors}`)
  console.log('════════════════════════════════════════')
}

// --- Blog Catalog Migration ---

type CatalogType = 'posts' | 'categories' | 'authors'
type ContentType = 'blog_post' | 'blog_category' | 'blog_author'

async function migrateBlogCatalog(catalogType: CatalogType, contentType: ContentType, stats: Record<string, number>) {
  const key = `spaces/${SPACE}/environments/${ENVIRONMENT}/blog/${catalogType}.json`
  console.log(`\nMigrating ${catalogType} catalog from ${key}...`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let items: any[]
  try {
    const raw = await getS3Object(key)
    if (!raw) {
      console.log(`  No catalog found at ${key}, skipping`)
      return
    }
    const parsed = JSON.parse(raw)
    items = parsed.items || []
  } catch (err) {
    console.error(`  Failed to read catalog ${key}:`, err)
    stats.errors++
    return
  }

  console.log(`  Found ${items.length} items in ${catalogType} catalog`)

  for (const entry of items) {
    const entryId = entry?.sys?.id
    if (!entryId) {
      console.warn('  Skipping entry with no sys.id')
      stats.skipped++
      continue
    }

    try {
      await pg.query('BEGIN')

      // Insert into generic cms_entries
      await pg.query(
        `INSERT INTO cms_entries (id, space, environment, entry_type, content, updated_at)
         VALUES ($1, $2, $3, 'Entry', $4, now())
         ON CONFLICT (space, environment, entry_type, id)
         DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
        [entryId, SPACE, ENVIRONMENT, JSON.stringify(entry)]
      )

      // Insert into typed blog table
      const fields = entry.fields || {}
      switch (contentType) {
        case 'blog_post':
          await pg.query(
            `INSERT INTO cms_blog_posts (id, space, environment, slug, title, published_date, category_id, author_id, content, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
             ON CONFLICT (space, environment, id)
             DO UPDATE SET slug = EXCLUDED.slug, title = EXCLUDED.title, published_date = EXCLUDED.published_date,
                           category_id = EXCLUDED.category_id, author_id = EXCLUDED.author_id,
                           content = EXCLUDED.content, updated_at = now()`,
            [
              entryId,
              SPACE,
              ENVIRONMENT,
              JSON.stringify(fields.id ?? {}),
              JSON.stringify(fields.title ?? {}),
              JSON.stringify(fields.publishedDate ?? {}),
              extractRefId(fields.category),
              extractRefId(fields.author),
              JSON.stringify(entry)
            ]
          )
          stats.posts++
          break
        case 'blog_category':
          await pg.query(
            `INSERT INTO cms_blog_categories (id, space, environment, slug, title, content, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             ON CONFLICT (space, environment, id)
             DO UPDATE SET slug = EXCLUDED.slug, title = EXCLUDED.title, content = EXCLUDED.content, updated_at = now()`,
            [
              entryId,
              SPACE,
              ENVIRONMENT,
              JSON.stringify(fields.id ?? {}),
              JSON.stringify(fields.title ?? {}),
              JSON.stringify(entry)
            ]
          )
          stats.categories++
          break
        case 'blog_author':
          await pg.query(
            `INSERT INTO cms_blog_authors (id, space, environment, slug, title, content, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             ON CONFLICT (space, environment, id)
             DO UPDATE SET slug = EXCLUDED.slug, title = EXCLUDED.title, content = EXCLUDED.content, updated_at = now()`,
            [
              entryId,
              SPACE,
              ENVIRONMENT,
              JSON.stringify(fields.id ?? {}),
              JSON.stringify(fields.title ?? {}),
              JSON.stringify(entry)
            ]
          )
          stats.authors++
          break
      }

      await pg.query('COMMIT')
    } catch (err) {
      await pg.query('ROLLBACK')
      console.error(`  Failed to migrate ${contentType} ${entryId}:`, err)
      stats.errors++
    }
  }

  console.log(`  Migrated ${items.length} ${catalogType}`)
}

// --- Individual S3 Object Migration ---

async function migrateS3Objects(
  prefix: string,
  entryType: 'Entry' | 'Asset',
  alreadyMigrated: Set<string>,
  stats: Record<string, number>
) {
  console.log(`\nMigrating ${entryType} objects from ${prefix}...`)

  let continuationToken: string | undefined
  let migrated = 0

  do {
    const listResult = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken
      })
    )

    const objects = listResult.Contents || []

    for (const obj of objects) {
      if (!obj.Key) continue
      const id = obj.Key.replace(prefix, '')

      if (alreadyMigrated.has(id)) {
        stats.skipped++
        continue
      }

      try {
        const raw = await getS3Object(obj.Key)
        if (!raw) {
          stats.skipped++
          continue
        }

        const content = JSON.parse(raw)

        await pg.query(
          `INSERT INTO cms_entries (id, space, environment, entry_type, content, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (space, environment, entry_type, id)
           DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
          [id, SPACE, ENVIRONMENT, entryType, JSON.stringify(content)]
        )

        migrated++
        if (entryType === 'Entry') stats.entries++
        else stats.assets++

        if (migrated % 50 === 0) {
          console.log(`  Progress: ${migrated} ${entryType} objects migrated...`)
        }
      } catch (err) {
        console.error(`  Failed to migrate ${entryType} ${id}:`, err)
        stats.errors++
      }
    }

    continuationToken = listResult.NextContinuationToken
  } while (continuationToken)

  console.log(`  Migrated ${migrated} ${entryType} objects`)
}

// --- Last-Sync Metadata ---

async function migrateLastSync(stats: Record<string, number>) {
  const key = `spaces/${SPACE}/environments/${ENVIRONMENT}/blog/.last-sync`
  console.log(`\nMigrating last-sync metadata from ${key}...`)

  try {
    const raw = await getS3Object(key)
    if (!raw) {
      console.log('  No last-sync found, skipping')
      return
    }

    await pg.query(
      `INSERT INTO cms_sync_metadata (space, environment, key, value, updated_at)
       VALUES ($1, $2, 'last-sync', $3, now())
       ON CONFLICT (space, environment, key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [SPACE, ENVIRONMENT, raw.trim()]
    )
    console.log(`  Migrated last-sync: ${raw.trim()}`)
  } catch (err) {
    console.error('  Failed to migrate last-sync:', err)
    stats.errors++
  }
}

// --- Helpers ---

async function getS3Object(key: string): Promise<string | null> {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    if (!result.Body) return null
    return await result.Body.transformToString('utf-8')
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'NoSuchKey') return null
    throw err
  }
}

function extractRefId(field: unknown): string | null {
  if (!field) return null
  const obj = field as Record<string, unknown>
  if (typeof field === 'object' && !(obj as Record<string, unknown>).sys) {
    for (const value of Object.values(obj)) {
      const id = (value as Record<string, Record<string, string>>)?.sys?.id
      if (id) return id
    }
    return null
  }
  return (obj as Record<string, Record<string, string>>)?.sys?.id ?? null
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing required environment variable: ${name}`)
    process.exit(1)
  }
  return value
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
