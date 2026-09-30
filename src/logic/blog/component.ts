import { localizeFields } from '../localization'
import type {
  BlogListItem,
  BlogListParams,
  BlogListResult,
  BlogUrl,
  BlogUrlListParams,
  BlogUrlListResult
} from './types'
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

/**
 * Lists the `view=urls` projection: slug, category slug and `sys.updatedAt` per entry, with
 * unroutable rows already excluded by the query so `total` counts only what is returned.
 * @param components - Database and logs components.
 * @param params - Already-validated projection parameters.
 */
export async function listBlogUrls(
  components: Pick<AppComponents, 'cmsDb' | 'logs'>,
  params: BlogUrlListParams
): Promise<BlogUrlListResult> {
  const { cmsDb, logs } = components
  const { space, environment, type, locale, limit, skip } = params

  const { rows, total } = await cmsDb.listBlogUrlProjection(space, environment, type, { locale, limit, skip })

  const items = rows.map(
    (row): BlogUrl => ({
      slug: row.slug,
      ...(row.category_slug ? { categorySlug: row.category_slug } : {}),
      updatedAt: row.updated_at
    })
  )

  logs.getLogger('blog').log('Blog URL view loaded', { type, count: String(items.length), total: String(total) })

  return { items, total, skip, limit }
}
