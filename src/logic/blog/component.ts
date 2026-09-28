import { localizeFields } from '../localization'
import type { BlogListItem, BlogListParams, BlogListResult, BlogUrl, BlogUrlsResult } from './types'
import type { ListResult } from '../../adapters/cms-db'
import type { AppComponents } from '../../types'

/**
 * Lists blog content (posts, categories, or authors) with filtering, pagination, and localization.
 * @param components - Database and logs components.
 * @param params - Already-validated listing parameters.
 */
export async function listBlog(
  components: Pick<AppComponents, 'cmsDb' | 'logs'>,
  params: BlogListParams
): Promise<BlogListResult> {
  const { cmsDb, logs } = components
  const logger = logs.getLogger('blog')
  const { space, environment, type, locale, slug, category, author, q, limit, skip } = params

  const listOpts = { locale, slug, category, author, q, limit, skip }

  let result: ListResult
  switch (type) {
    case 'posts':
      result = await cmsDb.listBlogPosts(space, environment, listOpts)
      break
    case 'categories':
      result = await cmsDb.listBlogCategories(space, environment, listOpts)
      break
    case 'authors':
      result = await cmsDb.listBlogAuthors(space, environment, listOpts)
      break
  }

  const items = result.items.map((entry) => ({
    ...entry,
    sys: { ...entry.sys, locale },
    fields: localizeFields(entry.fields, locale)
  })) as BlogListItem[]

  logger.log('Blog listing loaded', { type, count: String(items.length), total: String(result.total) })

  return { items, total: result.total, skip, limit }
}

/** Drops rows whose slug is missing for the requested locale: a URL cannot be built without one. */
function toBlogUrls(
  rows: Array<{ slug: string; category_slug?: string | null; updated_at: string | null }>
): BlogUrl[] {
  return rows
    .filter((row) => typeof row.slug === 'string' && row.slug.length > 0)
    .map((row) => ({
      slug: row.slug,
      ...(row.category_slug ? { categorySlug: row.category_slug } : {}),
      updatedAt: row.updated_at
    }))
}

/**
 * Every blog URL with its last-modified, for consumers that build links rather than render posts.
 * @param components - Database and logs components.
 * @param params - Already-validated space, environment and locale.
 */
export async function listBlogUrls(
  components: Pick<AppComponents, 'cmsDb' | 'logs'>,
  params: { space: string; environment: string; locale: string }
): Promise<BlogUrlsResult> {
  const { cmsDb, logs } = components
  const logger = logs.getLogger('blog')
  const { space, environment, locale } = params

  const rows = await cmsDb.listBlogUrls(space, environment, locale)
  // A post URL is `/blog/:categorySlug/:postSlug`, so a post whose category does not resolve has no
  // address. Dropped rather than emitted, so a consumer cannot build `/blog/undefined/...`, and
  // counted so the anomaly is visible instead of silent.
  const postRows = toBlogUrls(rows.posts)
  const posts = postRows.filter((post) => Boolean(post.categorySlug))
  const result = {
    posts,
    categories: toBlogUrls(rows.categories),
    authors: toBlogUrls(rows.authors)
  }

  logger.log('Blog URL index loaded', {
    posts: String(result.posts.length),
    postsWithoutCategory: String(postRows.length - posts.length),
    categories: String(result.categories.length),
    authors: String(result.authors.length)
  })

  return result
}
