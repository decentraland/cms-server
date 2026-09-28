import { localizeFields } from '../localization'
import type { BlogListItem, BlogListParams, BlogListResult, BlogUrl } from './types'
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
  const { space, environment, type, view, locale, slug, category, author, q, limit, skip } = params

  if (view === 'urls') {
    return listUrlView(components, { space, environment, type, locale, limit, skip })
  }

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

/**
 * Drops rows a consumer could not turn into a URL: no slug for any locale, and for posts no
 * category, since `/blog/:categorySlug/:postSlug` has no address without one. Dropping rather than
 * emitting keeps a consumer from building `/blog/undefined/...`; the count is logged so the
 * anomaly stays visible.
 */
async function listUrlView(
  components: Pick<AppComponents, 'cmsDb' | 'logs'>,
  params: {
    space: string
    environment: string
    type: BlogListParams['type']
    locale: string
    limit: number
    skip: number
  }
): Promise<BlogListResult> {
  const { cmsDb, logs } = components
  const { space, environment, type, locale, limit, skip } = params

  const { rows, total } = await cmsDb.listBlogUrlProjection(space, environment, type, { locale, limit, skip })

  const items = rows
    .filter((row) => typeof row.slug === 'string' && row.slug.length > 0)
    .filter((row) => type !== 'posts' || Boolean(row.category_slug))
    .map(
      (row): BlogUrl => ({
        slug: row.slug,
        ...(row.category_slug ? { categorySlug: row.category_slug } : {}),
        updatedAt: row.updated_at
      })
    )

  logs.getLogger('blog').log('Blog URL view loaded', {
    type,
    returned: String(items.length),
    dropped: String(rows.length - items.length),
    total: String(total)
  })

  return { items: items as unknown as BlogListItem[], total, skip, limit }
}
