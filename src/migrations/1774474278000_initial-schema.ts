/* eslint-disable @typescript-eslint/naming-convention */
import { PgType } from 'node-pg-migrate'
import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Generic cache for any Contentful Entry or Asset
  pgm.createTable('cms_entries', {
    id: { type: PgType.TEXT, notNull: true },
    space: { type: PgType.TEXT, notNull: true },
    environment: { type: PgType.TEXT, notNull: true },
    entry_type: { type: PgType.TEXT, notNull: true },
    content: { type: 'jsonb', notNull: true },
    created_at: { type: PgType.TIMESTAMP_WITH_TIME_ZONE, notNull: true, default: pgm.func('now()') },
    updated_at: { type: PgType.TIMESTAMP_WITH_TIME_ZONE, notNull: true, default: pgm.func('now()') }
  })
  pgm.addConstraint('cms_entries', 'cms_entries_pkey', {
    primaryKey: ['space', 'environment', 'entry_type', 'id']
  })

  // Blog posts with denormalized columns for filtering/sorting
  pgm.createTable('cms_blog_posts', {
    id: { type: PgType.TEXT, notNull: true },
    space: { type: PgType.TEXT, notNull: true },
    environment: { type: PgType.TEXT, notNull: true },
    slug: { type: 'jsonb', notNull: true },
    title: { type: 'jsonb', notNull: true },
    published_date: { type: 'jsonb', notNull: true },
    published_date_sort: { type: PgType.TIMESTAMP_WITH_TIME_ZONE },
    category_id: { type: PgType.TEXT },
    author_id: { type: PgType.TEXT },
    content: { type: 'jsonb', notNull: true },
    created_at: { type: PgType.TIMESTAMP_WITH_TIME_ZONE, notNull: true, default: pgm.func('now()') },
    updated_at: { type: PgType.TIMESTAMP_WITH_TIME_ZONE, notNull: true, default: pgm.func('now()') }
  })
  pgm.addConstraint('cms_blog_posts', 'cms_blog_posts_pkey', {
    primaryKey: ['space', 'environment', 'id']
  })
  pgm.createIndex('cms_blog_posts', ['space', 'environment', 'category_id'], {
    name: 'idx_cms_blog_posts_category'
  })
  pgm.createIndex('cms_blog_posts', ['space', 'environment', 'author_id'], {
    name: 'idx_cms_blog_posts_author'
  })
  pgm.sql('CREATE INDEX idx_cms_blog_posts_slug ON cms_blog_posts USING GIN (slug jsonb_path_ops)')
  pgm.sql(
    'CREATE INDEX idx_cms_blog_posts_date ON cms_blog_posts (space, environment, published_date_sort DESC NULLS LAST)'
  )

  // Blog categories
  pgm.createTable('cms_blog_categories', {
    id: { type: PgType.TEXT, notNull: true },
    space: { type: PgType.TEXT, notNull: true },
    environment: { type: PgType.TEXT, notNull: true },
    slug: { type: 'jsonb', notNull: true },
    title: { type: 'jsonb', notNull: true },
    content: { type: 'jsonb', notNull: true },
    created_at: { type: PgType.TIMESTAMP_WITH_TIME_ZONE, notNull: true, default: pgm.func('now()') },
    updated_at: { type: PgType.TIMESTAMP_WITH_TIME_ZONE, notNull: true, default: pgm.func('now()') }
  })
  pgm.addConstraint('cms_blog_categories', 'cms_blog_categories_pkey', {
    primaryKey: ['space', 'environment', 'id']
  })
  pgm.sql('CREATE INDEX idx_cms_blog_categories_slug ON cms_blog_categories USING GIN (slug jsonb_path_ops)')
  pgm.sql("CREATE INDEX idx_cms_blog_categories_title ON cms_blog_categories (space, environment, (title->>'en-US'))")

  // Blog authors
  pgm.createTable('cms_blog_authors', {
    id: { type: PgType.TEXT, notNull: true },
    space: { type: PgType.TEXT, notNull: true },
    environment: { type: PgType.TEXT, notNull: true },
    slug: { type: 'jsonb', notNull: true },
    title: { type: 'jsonb', notNull: true },
    content: { type: 'jsonb', notNull: true },
    created_at: { type: PgType.TIMESTAMP_WITH_TIME_ZONE, notNull: true, default: pgm.func('now()') },
    updated_at: { type: PgType.TIMESTAMP_WITH_TIME_ZONE, notNull: true, default: pgm.func('now()') }
  })
  pgm.addConstraint('cms_blog_authors', 'cms_blog_authors_pkey', {
    primaryKey: ['space', 'environment', 'id']
  })
  pgm.sql('CREATE INDEX idx_cms_blog_authors_slug ON cms_blog_authors USING GIN (slug jsonb_path_ops)')
  pgm.sql("CREATE INDEX idx_cms_blog_authors_title ON cms_blog_authors (space, environment, (title->>'en-US'))")

  // Metadata for sync tracking
  pgm.createTable('cms_sync_metadata', {
    space: { type: PgType.TEXT, notNull: true },
    environment: { type: PgType.TEXT, notNull: true },
    key: { type: PgType.TEXT, notNull: true },
    value: { type: PgType.TEXT, notNull: true },
    updated_at: { type: PgType.TIMESTAMP_WITH_TIME_ZONE, notNull: true, default: pgm.func('now()') }
  })
  pgm.addConstraint('cms_sync_metadata', 'cms_sync_metadata_pkey', {
    primaryKey: ['space', 'environment', 'key']
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('cms_sync_metadata')
  pgm.dropTable('cms_blog_authors')
  pgm.dropTable('cms_blog_categories')
  pgm.dropTable('cms_blog_posts')
  pgm.dropTable('cms_entries')
}
