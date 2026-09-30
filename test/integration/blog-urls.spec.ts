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

const base = (type: string) => `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/${type}`

test('when listing blog content with view=urls', ({ components }) => {
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

  describe('and the type is posts', () => {
    it('should return the slug, its category and the CMS last-modified in the listing envelope', async () => {
      const response = await components.localFetch.fetch(`${base('posts')}?view=urls&locale=en-US`)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toMatchObject({ total: 1, skip: 0 })
      expect(body.items).toHaveLength(1)
      expect(body.items[0].slug).toBe('first-post')
      expect(body.items[0].categorySlug).toBe('technology')
      expect(typeof body.items[0].updatedAt).toBe('string')
    })

    // The whole point of the view: no rich text on the wire.
    it('should not carry the post body', async () => {
      const response = await components.localFetch.fetch(`${base('posts')}?view=urls&locale=en-US`)

      expect(JSON.stringify(await response.json())).not.toContain('nodeType')
    })
  })

  describe('and the type is categories or authors', () => {
    it('should return their slugs without a category segment', async () => {
      const categories = await (
        await components.localFetch.fetch(`${base('categories')}?view=urls&locale=en-US`)
      ).json()
      const authors = await (await components.localFetch.fetch(`${base('authors')}?view=urls&locale=en-US`)).json()

      expect(categories.items.map((i: { slug: string }) => i.slug)).toContain('technology')
      expect(categories.items[0]).not.toHaveProperty('categorySlug')
      expect(authors.items).toHaveLength(1)
    })
  })

  describe('and the requested locale has its own slug', () => {
    it('should return that locale slug', async () => {
      const response = await components.localFetch.fetch(`${base('categories')}?view=urls&locale=es`)
      const body = await response.json()

      expect(body.items.map((i: { slug: string }) => i.slug)).toContain('tecnologia')
    })
  })

  // The listings fall back to en-US for a missing translation, so this view must too or it would
  // omit URLs the site still serves.
  describe('and an entry has no slug for the requested locale', () => {
    beforeEach(async () => {
      const category = createBlogCategoryEntry({ id: 'cat-2' })
      const fields = category.fields as Record<string, Record<string, unknown>>
      fields.id = { 'en-US': 'english-only' }
      await postWebhook(category)
    })

    it('should fall back to the default locale rather than dropping the URL', async () => {
      const response = await components.localFetch.fetch(`${base('categories')}?view=urls&locale=zh`)
      const body = await response.json()

      expect(body.items.map((i: { slug: string }) => i.slug)).toContain('english-only')
    })

    // Every slug the view emits has to resolve in the same locale, or the URL leads to a 404.
    it('should resolve that slug in the plain lookup for the same locale', async () => {
      const response = await components.localFetch.fetch(`${base('categories')}?slug=english-only&locale=zh`)
      const body = await response.json()

      expect(body.items.map((i: { sys: { id: string } }) => i.sys.id)).toEqual(['cat-2'])
    })
  })

  // `/blog/:categorySlug/:postSlug` cannot be built without a category.
  describe('and a post has no category', () => {
    beforeEach(async () => {
      await postWebhook(createBlogPostEntry({ id: 'post-orphan', slug: 'orphan-post', categoryId: null }))
    })

    it('should leave it out instead of emitting an unroutable URL', async () => {
      const response = await components.localFetch.fetch(`${base('posts')}?view=urls&locale=en-US`)
      const body = await response.json()

      expect(body.items.map((i: { slug: string }) => i.slug)).not.toContain('orphan-post')
    })

    it('should not count it in total either', async () => {
      const response = await components.localFetch.fetch(`${base('posts')}?view=urls&locale=en-US`)
      const body = await response.json()

      expect(body.total).toBe(body.items.length)
    })
  })

  // The projection has no way to apply these, so failing loudly beats returning the whole archive.
  describe('and a filter the view cannot honour is given', () => {
    let responses: Response[]

    beforeEach(async () => {
      responses = await Promise.all(
        ['slug=first-post', 'category=technology', 'author=john-doe', 'q=first'].map((filter) =>
          components.localFetch.fetch(`${base('posts')}?view=urls&locale=en-US&${filter}`)
        )
      )
    })

    it('should reject each of them with a 400', () => {
      expect(responses.map((r) => r.status)).toEqual([400, 400, 400, 400])
    })
  })

  describe('and the view is unknown', () => {
    it('should reject the request', async () => {
      const response = await components.localFetch.fetch(`${base('posts')}?view=nope&locale=en-US`)

      expect(response.status).toBe(400)
    })
  })

  describe('and no view is given', () => {
    it('should keep returning whole entries', async () => {
      const response = await components.localFetch.fetch(`${base('posts')}?locale=en-US`)
      const body = await response.json()

      expect(body.items[0]).toHaveProperty('fields')
      expect(body.items[0]).not.toHaveProperty('categorySlug')
    })
  })

  describe('and a limit above the view cap is requested', () => {
    it('should clamp it rather than reject', async () => {
      const response = await components.localFetch.fetch(`${base('posts')}?view=urls&locale=en-US&limit=9999`)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.limit).toBe(1000)
    })
  })
})
