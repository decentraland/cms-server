/* eslint-disable @typescript-eslint/naming-convention */
import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Adds PostgreSQL full-text + trigram fuzzy search to blog posts, authors and categories.
// Strategy: helper SQL functions extract plain text from Contentful rich-text JSON.
// - GENERATED STORED tsvector columns power exact/prefix matching (via @@ + to_tsquery) with GIN indexes.
// - GENERATED STORED text columns alongside them power typo-tolerant matching via pg_trgm's
//   word_similarity(), with GIN trigram indexes for future LIKE/% use cases.
// Because the columns are GENERATED, existing rows are populated automatically by ALTER TABLE
// and webhook/bulk-sync upserts don't need any code changes to stay in sync.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pg_trgm`)

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

  // Per-locale generated tsvector + trigram text columns on cms_blog_posts.
  pgm.sql(`
    ALTER TABLE cms_blog_posts
      ADD COLUMN search_vector_en_us tsvector
        GENERATED ALWAYS AS (to_tsvector('english', cms_blog_post_search_text(content, 'en-US'))) STORED,
      ADD COLUMN search_vector_es tsvector
        GENERATED ALWAYS AS (to_tsvector('spanish', cms_blog_post_search_text(content, 'es'))) STORED,
      ADD COLUMN search_vector_zh tsvector
        GENERATED ALWAYS AS (to_tsvector('simple',  cms_blog_post_search_text(content, 'zh'))) STORED,
      ADD COLUMN search_text_en_us text
        GENERATED ALWAYS AS (cms_blog_post_search_text(content, 'en-US')) STORED,
      ADD COLUMN search_text_es text
        GENERATED ALWAYS AS (cms_blog_post_search_text(content, 'es')) STORED,
      ADD COLUMN search_text_zh text
        GENERATED ALWAYS AS (cms_blog_post_search_text(content, 'zh')) STORED;
  `)
  pgm.sql(`CREATE INDEX idx_cms_blog_posts_search_en_us ON cms_blog_posts USING GIN (search_vector_en_us)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_posts_search_es    ON cms_blog_posts USING GIN (search_vector_es)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_posts_search_zh    ON cms_blog_posts USING GIN (search_vector_zh)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_posts_trgm_en_us ON cms_blog_posts USING GIN (search_text_en_us gin_trgm_ops)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_posts_trgm_es    ON cms_blog_posts USING GIN (search_text_es    gin_trgm_ops)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_posts_trgm_zh    ON cms_blog_posts USING GIN (search_text_zh    gin_trgm_ops)`)

  // Per-locale generated tsvector + trigram text columns on cms_blog_authors.
  pgm.sql(`
    ALTER TABLE cms_blog_authors
      ADD COLUMN search_vector_en_us tsvector
        GENERATED ALWAYS AS (to_tsvector('english', cms_blog_ref_search_text(content, 'en-US'))) STORED,
      ADD COLUMN search_vector_es tsvector
        GENERATED ALWAYS AS (to_tsvector('spanish', cms_blog_ref_search_text(content, 'es'))) STORED,
      ADD COLUMN search_vector_zh tsvector
        GENERATED ALWAYS AS (to_tsvector('simple',  cms_blog_ref_search_text(content, 'zh'))) STORED,
      ADD COLUMN search_text_en_us text
        GENERATED ALWAYS AS (cms_blog_ref_search_text(content, 'en-US')) STORED,
      ADD COLUMN search_text_es text
        GENERATED ALWAYS AS (cms_blog_ref_search_text(content, 'es')) STORED,
      ADD COLUMN search_text_zh text
        GENERATED ALWAYS AS (cms_blog_ref_search_text(content, 'zh')) STORED;
  `)
  pgm.sql(`CREATE INDEX idx_cms_blog_authors_search_en_us ON cms_blog_authors USING GIN (search_vector_en_us)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_authors_search_es    ON cms_blog_authors USING GIN (search_vector_es)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_authors_search_zh    ON cms_blog_authors USING GIN (search_vector_zh)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_authors_trgm_en_us ON cms_blog_authors USING GIN (search_text_en_us gin_trgm_ops)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_authors_trgm_es    ON cms_blog_authors USING GIN (search_text_es    gin_trgm_ops)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_authors_trgm_zh    ON cms_blog_authors USING GIN (search_text_zh    gin_trgm_ops)`)

  // Per-locale generated tsvector + trigram text columns on cms_blog_categories.
  pgm.sql(`
    ALTER TABLE cms_blog_categories
      ADD COLUMN search_vector_en_us tsvector
        GENERATED ALWAYS AS (to_tsvector('english', cms_blog_ref_search_text(content, 'en-US'))) STORED,
      ADD COLUMN search_vector_es tsvector
        GENERATED ALWAYS AS (to_tsvector('spanish', cms_blog_ref_search_text(content, 'es'))) STORED,
      ADD COLUMN search_vector_zh tsvector
        GENERATED ALWAYS AS (to_tsvector('simple',  cms_blog_ref_search_text(content, 'zh'))) STORED,
      ADD COLUMN search_text_en_us text
        GENERATED ALWAYS AS (cms_blog_ref_search_text(content, 'en-US')) STORED,
      ADD COLUMN search_text_es text
        GENERATED ALWAYS AS (cms_blog_ref_search_text(content, 'es')) STORED,
      ADD COLUMN search_text_zh text
        GENERATED ALWAYS AS (cms_blog_ref_search_text(content, 'zh')) STORED;
  `)
  pgm.sql(`CREATE INDEX idx_cms_blog_categories_search_en_us ON cms_blog_categories USING GIN (search_vector_en_us)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_categories_search_es    ON cms_blog_categories USING GIN (search_vector_es)`)
  pgm.sql(`CREATE INDEX idx_cms_blog_categories_search_zh    ON cms_blog_categories USING GIN (search_vector_zh)`)
  pgm.sql(
    `CREATE INDEX idx_cms_blog_categories_trgm_en_us ON cms_blog_categories USING GIN (search_text_en_us gin_trgm_ops)`
  )
  pgm.sql(
    `CREATE INDEX idx_cms_blog_categories_trgm_es    ON cms_blog_categories USING GIN (search_text_es    gin_trgm_ops)`
  )
  pgm.sql(
    `CREATE INDEX idx_cms_blog_categories_trgm_zh    ON cms_blog_categories USING GIN (search_text_zh    gin_trgm_ops)`
  )
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_categories_trgm_zh`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_categories_trgm_es`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_categories_trgm_en_us`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_categories_search_zh`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_categories_search_es`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_categories_search_en_us`)
  pgm.sql(`
    ALTER TABLE cms_blog_categories
      DROP COLUMN IF EXISTS search_text_zh,
      DROP COLUMN IF EXISTS search_text_es,
      DROP COLUMN IF EXISTS search_text_en_us,
      DROP COLUMN IF EXISTS search_vector_zh,
      DROP COLUMN IF EXISTS search_vector_es,
      DROP COLUMN IF EXISTS search_vector_en_us;
  `)

  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_authors_trgm_zh`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_authors_trgm_es`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_authors_trgm_en_us`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_authors_search_zh`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_authors_search_es`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_authors_search_en_us`)
  pgm.sql(`
    ALTER TABLE cms_blog_authors
      DROP COLUMN IF EXISTS search_text_zh,
      DROP COLUMN IF EXISTS search_text_es,
      DROP COLUMN IF EXISTS search_text_en_us,
      DROP COLUMN IF EXISTS search_vector_zh,
      DROP COLUMN IF EXISTS search_vector_es,
      DROP COLUMN IF EXISTS search_vector_en_us;
  `)

  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_posts_trgm_zh`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_posts_trgm_es`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_posts_trgm_en_us`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_posts_search_zh`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_posts_search_es`)
  pgm.sql(`DROP INDEX IF EXISTS idx_cms_blog_posts_search_en_us`)
  pgm.sql(`
    ALTER TABLE cms_blog_posts
      DROP COLUMN IF EXISTS search_text_zh,
      DROP COLUMN IF EXISTS search_text_es,
      DROP COLUMN IF EXISTS search_text_en_us,
      DROP COLUMN IF EXISTS search_vector_zh,
      DROP COLUMN IF EXISTS search_vector_es,
      DROP COLUMN IF EXISTS search_vector_en_us;
  `)

  pgm.sql(`DROP FUNCTION IF EXISTS cms_blog_ref_search_text(jsonb, text)`)
  pgm.sql(`DROP FUNCTION IF EXISTS cms_blog_post_search_text(jsonb, text)`)
  pgm.sql(`DROP FUNCTION IF EXISTS cms_rich_text_to_plain(jsonb)`)
}
