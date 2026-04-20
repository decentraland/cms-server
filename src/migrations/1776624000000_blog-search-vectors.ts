/* eslint-disable @typescript-eslint/naming-convention */
import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Adds PostgreSQL full-text search to blog posts, authors and categories.
// Strategy: helper SQL functions extract plain text from Contentful rich-text JSON,
// and GENERATED STORED tsvector columns keep an index in sync with `content` on every write.
// Because the columns are GENERATED, existing rows are populated automatically by ALTER TABLE
// and webhook/bulk-sync upserts don't need any code changes to stay in sync.

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Walks a Contentful rich-text Document and concatenates every `value` field
  // found under a node with `nodeType == "text"`.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION cms_rich_text_to_plain(doc jsonb)
    RETURNS text AS $$
      SELECT coalesce(string_agg(v #>> '{}', ' '), '')
      FROM jsonb_path_query(doc, 'strict $.** ? (@.nodeType == "text").value') AS v;
    $$ LANGUAGE sql IMMUTABLE;
  `)

  pgm.sql(`
    CREATE OR REPLACE FUNCTION cms_blog_post_search_text(content jsonb, locale text)
    RETURNS text AS $$
      SELECT concat_ws(' ',
        content->'fields'->'title'->>locale,
        content->'fields'->'description'->>locale,
        cms_rich_text_to_plain(content->'fields'->'body'->locale)
      );
    $$ LANGUAGE sql IMMUTABLE;
  `)

  pgm.sql(`
    CREATE OR REPLACE FUNCTION cms_blog_ref_search_text(content jsonb, locale text)
    RETURNS text AS $$
      SELECT concat_ws(' ',
        content->'fields'->'title'->>locale,
        content->'fields'->'description'->>locale
      );
    $$ LANGUAGE sql IMMUTABLE;
  `)

  // Per-locale generated tsvector columns on cms_blog_posts.
  pgm.sql(`
    ALTER TABLE cms_blog_posts
      ADD COLUMN search_vector_en_us tsvector
        GENERATED ALWAYS AS (to_tsvector('english', cms_blog_post_search_text(content, 'en-US'))) STORED,
      ADD COLUMN search_vector_es tsvector
        GENERATED ALWAYS AS (to_tsvector('spanish', cms_blog_post_search_text(content, 'es'))) STORED,
      ADD COLUMN search_vector_zh tsvector
        GENERATED ALWAYS AS (to_tsvector('simple',  cms_blog_post_search_text(content, 'zh'))) STORED;
  `)
  pgm.sql(`CREATE INDEX idx_cms_blog_posts_search_en_us ON cms_blog_posts USING GIN (search_vector_en_us)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_posts_search_es    ON cms_blog_posts USING GIN (search_vector_es)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_posts_search_zh    ON cms_blog_posts USING GIN (search_vector_zh)`)

  // Per-locale generated tsvector columns on cms_blog_authors.
  pgm.sql(`
    ALTER TABLE cms_blog_authors
      ADD COLUMN search_vector_en_us tsvector
        GENERATED ALWAYS AS (to_tsvector('english', cms_blog_ref_search_text(content, 'en-US'))) STORED,
      ADD COLUMN search_vector_es tsvector
        GENERATED ALWAYS AS (to_tsvector('spanish', cms_blog_ref_search_text(content, 'es'))) STORED,
      ADD COLUMN search_vector_zh tsvector
        GENERATED ALWAYS AS (to_tsvector('simple',  cms_blog_ref_search_text(content, 'zh'))) STORED;
  `)
  pgm.sql(`CREATE INDEX idx_cms_blog_authors_search_en_us ON cms_blog_authors USING GIN (search_vector_en_us)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_authors_search_es    ON cms_blog_authors USING GIN (search_vector_es)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_authors_search_zh    ON cms_blog_authors USING GIN (search_vector_zh)`)

  // Per-locale generated tsvector columns on cms_blog_categories.
  pgm.sql(`
    ALTER TABLE cms_blog_categories
      ADD COLUMN search_vector_en_us tsvector
        GENERATED ALWAYS AS (to_tsvector('english', cms_blog_ref_search_text(content, 'en-US'))) STORED,
      ADD COLUMN search_vector_es tsvector
        GENERATED ALWAYS AS (to_tsvector('spanish', cms_blog_ref_search_text(content, 'es'))) STORED,
      ADD COLUMN search_vector_zh tsvector
        GENERATED ALWAYS AS (to_tsvector('simple',  cms_blog_ref_search_text(content, 'zh'))) STORED;
  `)
  pgm.sql(`CREATE INDEX idx_cms_blog_categories_search_en_us ON cms_blog_categories USING GIN (search_vector_en_us)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_categories_search_es    ON cms_blog_categories USING GIN (search_vector_es)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_categories_search_zh    ON cms_blog_categories USING GIN (search_vector_zh)`)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_categories_search_zh`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_categories_search_es`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_categories_search_en_us`)
  pgm.sql(`
    ALTER TABLE cms_blog_categories
      DROP COLUMN IF EXISTS search_vector_zh,
      DROP COLUMN IF EXISTS search_vector_es,
      DROP COLUMN IF EXISTS search_vector_en_us;
  `)

  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_authors_search_zh`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_authors_search_es`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_authors_search_en_us`)
  pgm.sql(`
    ALTER TABLE cms_blog_authors
      DROP COLUMN IF EXISTS search_vector_zh,
      DROP COLUMN IF EXISTS search_vector_es,
      DROP COLUMN IF EXISTS search_vector_en_us;
  `)

  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_posts_search_zh`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_posts_search_es`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_posts_search_en_us`)
  pgm.sql(`
    ALTER TABLE cms_blog_posts
      DROP COLUMN IF EXISTS search_vector_zh,
      DROP COLUMN IF EXISTS search_vector_es,
      DROP COLUMN IF EXISTS search_vector_en_us;
  `)

  pgm.sql(`DROP FUNCTION IF EXISTS cms_blog_ref_search_text(jsonb, text)`)
  pgm.sql(`DROP FUNCTION IF EXISTS cms_blog_post_search_text(jsonb, text)`)
  pgm.sql(`DROP FUNCTION IF EXISTS cms_rich_text_to_plain(jsonb)`)
}
