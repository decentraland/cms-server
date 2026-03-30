import { localizeFields } from '../localization'
import type { BlogListParams, BlogListResult } from './types'
import type { AppComponents } from '../../types'
import type { Entry } from 'contentful'

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
  const { space, environment, type, locale, slug, category, author, limit, skip } = params

  const listOpts = { locale, slug, category, author, limit, skip }

  let result: { items: Entry[]; total: number }
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

  const items = result.items.map((entry: Entry) => ({
    ...entry,
    sys: { ...entry.sys, locale },
    fields: localizeFields(entry.fields, locale)
  })) as Entry[]

  logger.log('Blog listing loaded', { type, count: String(items.length), total: String(result.total) })

  return { items, total: result.total, skip, limit }
}
