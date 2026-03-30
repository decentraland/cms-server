import nock from 'nock'
import SQL from 'sql-template-strings'
import { test } from '../components'
import {
  TEST_ENVIRONMENT,
  TEST_SPACE,
  TEST_TOKEN,
  cleanTestDb,
  createAssetEntry,
  createBlogAuthorEntry,
  createBlogCategoryEntry,
  createBlogPostEntry,
  findBlogCategory,
  findBlogPost,
  findCachedEntry
} from '../helpers'

test('when receiving a webhook event', ({ components }) => {
  beforeEach(async () => {
    await cleanTestDb(components.pg)
    nock.cleanAll()
  })

  afterEach(() => {
    nock.cleanAll()
  })

  function postWebhook(entry: Record<string, unknown>, action: 'publish' | 'unpublish') {
    const sys = entry.sys as Record<string, unknown>
    const type = sys.type === 'Asset' || sys.type === 'DeletedAsset' ? 'Asset' : 'Entry'
    return components.localFetch.fetch('/webhook', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'X-Contentful-Topic': `ContentManagement.${type}.${action}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(entry)
    })
  }

  describe('and a blog post is published', () => {
    let response: Awaited<ReturnType<typeof postWebhook>>
    let post: ReturnType<typeof createBlogPostEntry>

    beforeEach(async () => {
      post = createBlogPostEntry()
      response = await postWebhook(post, 'publish')
    })

    it('should respond with 200 and ok status', async () => {
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'ok' })
    })

    it('should store the entry in the database with correct slug and references', async () => {
      const row = await findBlogPost(components.pg, TEST_SPACE, TEST_ENVIRONMENT, 'post-1')
      expect(row).not.toBeNull()
      expect(row.slug).toEqual({ 'en-US': 'test-post', es: 'test-post-es', zh: 'test-post-zh' })
      expect(row.category_id).toBe('cat-1')
      expect(row.author_id).toBe('author-1')
    })
  })

  describe('and a blog post is unpublished', () => {
    let response: Awaited<ReturnType<typeof postWebhook>>

    beforeEach(async () => {
      const post = createBlogPostEntry()
      await postWebhook(post, 'publish')

      const postSys = post.sys as Record<string, unknown>
      const deletedPost = { ...post, sys: { ...postSys, type: 'DeletedEntry' } }
      response = await postWebhook(deletedPost, 'unpublish')
    })

    it('should respond with 200', async () => {
      expect(response.status).toBe(200)
    })

    it('should remove the entry from the database', async () => {
      const row = await findBlogPost(components.pg, TEST_SPACE, TEST_ENVIRONMENT, 'post-1')
      expect(row).toBeNull()
    })
  })

  describe('and an asset is published', () => {
    let response: Awaited<ReturnType<typeof postWebhook>>

    beforeEach(async () => {
      const asset = createAssetEntry()
      response = await postWebhook(asset, 'publish')
    })

    it('should respond with 200', async () => {
      expect(response.status).toBe(200)
    })

    it('should transform asset URLs to Decentraland CDN', async () => {
      const row = await findCachedEntry(components.pg, TEST_SPACE, TEST_ENVIRONMENT, 'Asset', 'asset-1')
      expect(row).not.toBeNull()
      const content = row!.content as Record<string, any>
      expect(content.fields.file['en-US'].url).toContain('cms-images.decentraland.org')
    })
  })

  describe('and the authorization is invalid', () => {
    let response: Awaited<ReturnType<typeof components.localFetch.fetch>>

    beforeEach(async () => {
      const post = createBlogPostEntry()
      response = await components.localFetch.fetch('/webhook', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer wrong-token',
          'X-Contentful-Topic': 'ContentManagement.Entry.publish',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(post)
      })
    })

    it('should return 404', async () => {
      expect(response.status).toBe(404)
    })
  })

  describe('and a blog category is published', () => {
    let response: Awaited<ReturnType<typeof postWebhook>>

    beforeEach(async () => {
      const category = createBlogCategoryEntry()
      response = await postWebhook(category, 'publish')
    })

    it('should respond with 200', async () => {
      expect(response.status).toBe(200)
    })

    it('should store the category with correct slugs', async () => {
      const row = await findBlogCategory(components.pg, TEST_SPACE, TEST_ENVIRONMENT, 'cat-1')
      expect(row).not.toBeNull()
      expect(row.slug).toEqual({ 'en-US': 'technology', es: 'tecnologia', zh: '技术' })
    })
  })

  describe('and a blog author is published', () => {
    let response: Awaited<ReturnType<typeof postWebhook>>

    beforeEach(async () => {
      const author = createBlogAuthorEntry()
      response = await postWebhook(author, 'publish')
    })

    it('should respond with 200', async () => {
      expect(response.status).toBe(200)
    })

    it('should store the author with correct slugs', async () => {
      const result = await components.pg.query(
        SQL`SELECT slug, title FROM cms_blog_authors WHERE space = ${TEST_SPACE} AND environment = ${TEST_ENVIRONMENT} AND id = ${'author-1'}`
      )
      expect(result.rows[0]).not.toBeUndefined()
      expect(result.rows[0].slug).toEqual({ 'en-US': 'john-doe', es: 'john-doe', zh: 'john-doe' })
    })
  })

  describe('and the webhook topic is invalid', () => {
    let response: Awaited<ReturnType<typeof components.localFetch.fetch>>

    beforeEach(async () => {
      const post = createBlogPostEntry()
      response = await components.localFetch.fetch('/webhook', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_TOKEN}`,
          'X-Contentful-Topic': 'ContentManagement.Entry.invalid_action',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(post)
      })
    })

    it('should return 404', async () => {
      expect(response.status).toBe(404)
    })
  })
})
