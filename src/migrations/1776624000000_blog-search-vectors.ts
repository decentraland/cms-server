/* eslint-disable @typescript-eslint/naming-convention */
import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Adds PostgreSQL full-text + trigram fuzzy search to blog posts, authors and categories.
// Strategy: helper SQL functions extract plain text from Contentful rich-text JSON.
// - GENERATED STORED tsvector columns power exact/prefix matching (via @@ + to_tsquery) with GIN indexes.
// - GENERATED STORED text columns alongside them power typo-tolerant matching via pg_trgm's
//   word_similarity(), called inline in the WHERE clause at query time.
// Because the columns are GENERATED, existing rows are populated automatically by ALTER TABLE
// and webhook/bulk-sync upserts don't need any code changes to stay in sync.
//
// Operational note: ALTER TABLE ... ADD COLUMN ... GENERATED ALWAYS AS (...) STORED rewrites
// the whole table under an ACCESS EXCLUSIVE lock, and the CREATE INDEX statements below each
// hold a SHARE lock. The blog tables are small (low hundreds of rows today), so this runs in
// well under a second; if that ever changes, deploy with a brief maintenance window or switch
// to CREATE INDEX CONCURRENTLY (which requires noTransaction mode in node-pg-migrate).

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pg_trgm`)

  // Walks a Contentful rich-text Document and concatenates every `value` field
  // found under a node with `nodeType == "text"`. Uses a recursive CTE over
  // jsonb_array_elements rather than jsonb_path_query because the latter is
  // classified as STABLE in PostgreSQL (even though it's effectively
  // deterministic for a given input), and generated STORED columns require
  // genuinely IMMUTABLE expressions. jsonb_array_elements and jsonb_typeof are
  // both IMMUTABLE, so this function's volatility classification is accurate.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION cms_rich_text_to_plain(doc jsonb)
    RETURNS text AS $$
      WITH RECURSIVE nodes(node) AS (
        SELECT doc WHERE jsonb_typeof(doc) = 'object'
        UNION ALL
        SELECT child
        FROM nodes, jsonb_array_elements(node->'content') AS child
        WHERE jsonb_typeof(node->'content') = 'array'
      )
      SELECT coalesce(string_agg(node->>'value', ' '), '')
      FROM nodes
      WHERE node->>'nodeType' = 'text';
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

  // Weighted tsvector builders. ts_rank multiplies contributions by the weight class
  // (A=1.0, B=0.4, C=0.2 with default weights), so title hits naturally outrank body hits
  // and author/category hits correspondingly show up lower in the ranking than post hits.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION cms_blog_post_weighted_tsv(content jsonb, locale text, cfg regconfig)
    RETURNS tsvector AS $$
      SELECT
        setweight(to_tsvector(cfg, coalesce(content->'fields'->'title'->>locale, '')), 'A') ||
        setweight(to_tsvector(cfg, coalesce(content->'fields'->'description'->>locale, '')), 'B') ||
        setweight(to_tsvector(cfg, cms_rich_text_to_plain(content->'fields'->'body'->locale)), 'C');
    $$ LANGUAGE sql IMMUTABLE;
  `)

  pgm.sql(`
    CREATE OR REPLACE FUNCTION cms_blog_ref_weighted_tsv(content jsonb, locale text, cfg regconfig)
    RETURNS tsvector AS $$
      SELECT
        setweight(to_tsvector(cfg, coalesce(content->'fields'->'title'->>locale, '')), 'A') ||
        setweight(to_tsvector(cfg, coalesce(content->'fields'->'description'->>locale, '')), 'B');
    $$ LANGUAGE sql IMMUTABLE;
  `)

  // Per-locale generated tsvector + trigram text columns on cms_blog_posts.
  pgm.sql(`
    ALTER TABLE cms_blog_posts
      ADD COLUMN search_vector_en_us tsvector
        GENERATED ALWAYS AS (cms_blog_post_weighted_tsv(content, 'en-US', 'english')) STORED,
      ADD COLUMN search_vector_es tsvector
        GENERATED ALWAYS AS (cms_blog_post_weighted_tsv(content, 'es',    'spanish')) STORED,
      ADD COLUMN search_vector_zh tsvector
        GENERATED ALWAYS AS (cms_blog_post_weighted_tsv(content, 'zh',    'simple')) STORED,
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

  // Per-locale generated tsvector + trigram text columns on cms_blog_authors.
  pgm.sql(`
    ALTER TABLE cms_blog_authors
      ADD COLUMN search_vector_en_us tsvector
        GENERATED ALWAYS AS (cms_blog_ref_weighted_tsv(content, 'en-US', 'english')) STORED,
      ADD COLUMN search_vector_es tsvector
        GENERATED ALWAYS AS (cms_blog_ref_weighted_tsv(content, 'es',    'spanish')) STORED,
      ADD COLUMN search_vector_zh tsvector
        GENERATED ALWAYS AS (cms_blog_ref_weighted_tsv(content, 'zh',    'simple')) STORED,
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

  // Per-locale generated tsvector + trigram text columns on cms_blog_categories.
  pgm.sql(`
    ALTER TABLE cms_blog_categories
      ADD COLUMN search_vector_en_us tsvector
        GENERATED ALWAYS AS (cms_blog_ref_weighted_tsv(content, 'en-US', 'english')) STORED,
      ADD COLUMN search_vector_es tsvector
        GENERATED ALWAYS AS (cms_blog_ref_weighted_tsv(content, 'es',    'spanish')) STORED,
      ADD COLUMN search_vector_zh tsvector
        GENERATED ALWAYS AS (cms_blog_ref_weighted_tsv(content, 'zh',    'simple')) STORED,
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
}

export async function down(pgm: MigrationBuilder): Promise<void> {
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

  pgm.sql(`DROP FUNCTION IF EXISTS cms_blog_ref_weighted_tsv(jsonb, text, regconfig)`)
  pgm.sql(`DROP FUNCTION IF EXISTS cms_blog_post_weighted_tsv(jsonb, text, regconfig)`)
  pgm.sql(`DROP FUNCTION IF EXISTS cms_blog_ref_search_text(jsonb, text)`)
  pgm.sql(`DROP FUNCTION IF EXISTS cms_blog_post_search_text(jsonb, text)`)
  pgm.sql(`DROP FUNCTION IF EXISTS cms_rich_text_to_plain(jsonb)`)
}
