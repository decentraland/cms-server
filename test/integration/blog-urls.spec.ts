import nock from 'nock'
import { test } from '../components'
import {
  TEST_ENVIRONMENT,
  TEST_SPACE,
  TEST_TOKEN,
  cleanTestDb,
  createBlogAuthorEntry,
  createBlogCategoryEntry,
  createBlogPostEntry
} from '../helpers'

const BASE = `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/urls`

test('when reading the blog URL index', ({ components }) => {
  function postWebhook(entry: Record<string, unknown>) {
    return components.localFetch.fetch('/webhook', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'X-Contentful-Topic': 'ContentManagement.Entry.publish',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(entry)
    })
  }

  beforeEach(async () => {
    await cleanTestDb(components.pg)
    nock.cleanAll()

    await postWebhook(createBlogCategoryEntry())
    await postWebhook(createBlogAuthorEntry())
    await postWebhook(createBlogPostEntry({ id: 'post-1', slug: 'first-post' }))
  })

  describe('and the requested locale is the default one', () => {
    it('should return every slug with its category and its CMS last-modified', async () => {
      const response = await components.localFetch.fetch(`${BASE}?locale=en-US`)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.posts).toHaveLength(1)
      expect(body.posts[0].slug).toBe('first-post')
      expect(body.posts[0].categorySlug).toBe('technology')
      expect(typeof body.posts[0].updatedAt).toBe('string')
      expect(body.categories.map((c: { slug: string }) => c.slug)).toContain('technology')
      expect(body.authors).toHaveLength(1)
    })

    // The whole point of the endpoint: no rich text on the wire.
    it('should not carry the post body', async () => {
      const response = await components.localFetch.fetch(`${BASE}?locale=en-US`)

      expect(JSON.stringify(await response.json())).not.toContain('nodeType')
    })
  })

  describe('and the requested locale has its own slug', () => {
    it('should return that locale slug', async () => {
      const response = await components.localFetch.fetch(`${BASE}?locale=es`)
      const body = await response.json()

      expect(body.categories.map((c: { slug: string }) => c.slug)).toContain('tecnologia')
    })
  })

  // The listing endpoints fall back to en-US for a missing translation, so this one must too or it
  // would omit URLs the site still serves.
  describe('and an entry has no slug for the requested locale', () => {
    beforeEach(async () => {
      const category = createBlogCategoryEntry({ id: 'cat-2' })
      const fields = category.fields as Record<string, Record<string, unknown>>
      fields.id = { 'en-US': 'english-only' }
      await postWebhook(category)
    })

    it('should fall back to the default locale rather than dropping the URL', async () => {
      const response = await components.localFetch.fetch(`${BASE}?locale=zh`)
      const body = await response.json()

      expect(body.categories.map((c: { slug: string }) => c.slug)).toContain('english-only')
    })
  })

  // `/blog/:categorySlug/:postSlug` cannot be built without a category.
  describe('and a post has no category', () => {
    beforeEach(async () => {
      await postWebhook(createBlogPostEntry({ id: 'post-orphan', slug: 'orphan-post', categoryId: null }))
    })

    it('should leave it out instead of emitting an unroutable URL', async () => {
      const response = await components.localFetch.fetch(`${BASE}?locale=en-US`)
      const body = await response.json()

      expect(body.posts.map((p: { slug: string }) => p.slug)).not.toContain('orphan-post')
    })
  })

  describe('and the locale is unknown', () => {
    it('should reject the request', async () => {
      const response = await components.localFetch.fetch(`${BASE}?locale=klingon`)

      expect(response.status).toBe(400)
    })
  })

  // Registered before `/blog/:type`, which would otherwise answer `Invalid blog type: urls`.
  describe('and the listing route could shadow this one', () => {
    it('should reach this handler rather than the listing handler', async () => {
      const response = await components.localFetch.fetch(`${BASE}?locale=en-US`)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('posts')
      expect(body).not.toHaveProperty('items')
    })
  })

  describe('and the space does not match the configured one', () => {
    it('should answer not found', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/other-space/environments/${TEST_ENVIRONMENT}/blog/urls?locale=en-US`
      )

      expect(response.status).toBe(404)
    })
  })
})
