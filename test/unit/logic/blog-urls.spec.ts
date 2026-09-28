import { listBlogUrls } from '../../../src/logic/blog'
import type { BlogUrlRows } from '../../../src/adapters/cms-db'
import type { AppComponents } from '../../../src/types'

function componentsWith(rows: BlogUrlRows) {
  const listBlogUrlsMock = jest.fn().mockResolvedValue(rows)
  const components = {
    cmsDb: { listBlogUrls: listBlogUrlsMock },
    logs: { getLogger: () => ({ log: jest.fn() }) }
  } as unknown as Pick<AppComponents, 'cmsDb' | 'logs'>
  return { components, listBlogUrlsMock }
}

const emptyRows: BlogUrlRows = { posts: [], categories: [], authors: [] }

describe('when listing blog URLs', () => {
  describe('and a post has a category', () => {
    it('should expose the category slug so the post URL can be built', async () => {
      const { components } = componentsWith({
        ...emptyRows,
        posts: [{ slug: 'a-post', category_slug: 'announcements', updated_at: '2026-09-04T19:03:33.340Z' }]
      })

      const result = await listBlogUrls(components, { space: 's', environment: 'master', locale: 'en-US' })

      expect(result.posts).toEqual([
        { slug: 'a-post', categorySlug: 'announcements', updatedAt: '2026-09-04T19:03:33.340Z' }
      ])
    })
  })

  // `/blog/:categorySlug/:postSlug` has no address without a category, so the row is not a URL.
  describe('and a post has no category', () => {
    it('should drop it rather than emit an unroutable URL', async () => {
      const { components } = componentsWith({
        ...emptyRows,
        posts: [
          { slug: 'orphan', category_slug: null, updated_at: null },
          { slug: 'kept', category_slug: 'announcements', updated_at: null }
        ]
      })

      const result = await listBlogUrls(components, { space: 's', environment: 'master', locale: 'en-US' })

      expect(result.posts.map((post) => post.slug)).toEqual(['kept'])
    })
  })

  // A URL cannot be built without a slug, and an entry can be missing one for a given locale.
  describe('and a row has no slug for the requested locale', () => {
    it('should drop it', async () => {
      const { components } = componentsWith({
        posts: [
          { slug: '', category_slug: 'announcements', updated_at: null },
          { slug: 'kept', category_slug: 'announcements', updated_at: null }
        ],
        categories: [{ slug: null as unknown as string, updated_at: null }],
        authors: []
      })

      const result = await listBlogUrls(components, { space: 's', environment: 'master', locale: 'en-US' })

      expect(result.posts).toHaveLength(1)
      expect(result.posts[0].slug).toBe('kept')
      expect(result.categories).toHaveLength(0)
    })
  })

  describe('and the entry has never been updated in the CMS', () => {
    it('should report a null lastmod rather than inventing one', async () => {
      const { components } = componentsWith({
        ...emptyRows,
        authors: [{ slug: 'nacho', updated_at: null }]
      })

      const result = await listBlogUrls(components, { space: 's', environment: 'master', locale: 'en-US' })

      expect(result.authors).toEqual([{ slug: 'nacho', updatedAt: null }])
    })
  })

  describe('and the caller asks for a locale', () => {
    it('should pass it straight to the projection', async () => {
      const { components, listBlogUrlsMock } = componentsWith(emptyRows)

      await listBlogUrls(components, { space: 'space-1', environment: 'master', locale: 'es-ES' })

      expect(listBlogUrlsMock).toHaveBeenCalledWith('space-1', 'master', 'es-ES')
    })
  })
})
