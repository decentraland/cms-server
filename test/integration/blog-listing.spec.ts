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

test('when listing blog content', ({ components }) => {
  function postWebhook(entry: Record<string, unknown>) {
    const sys = entry.sys as Record<string, unknown>
    const type = sys.type === 'Asset' ? 'Asset' : 'Entry'
    return components.localFetch.fetch('/webhook', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'X-Contentful-Topic': `ContentManagement.${type}.publish`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(entry)
    })
  }

  beforeEach(async () => {
    await cleanTestDb(components.pg)
    nock.cleanAll()

    const category = createBlogCategoryEntry()
    const author = createBlogAuthorEntry()
    const post1 = createBlogPostEntry({
      id: 'post-1',
      slug: 'first-post',
      title: 'First Post',
      publishedDate: '2024-01-15T00:00:00.000Z'
    })
    const post2 = createBlogPostEntry({
      id: 'post-2',
      slug: 'second-post',
      title: 'Second Post',
      publishedDate: '2024-02-15T00:00:00.000Z'
    })
    const post3 = createBlogPostEntry({
      id: 'post-3',
      slug: 'third-post',
      title: 'Third Post',
      publishedDate: '2024-03-15T00:00:00.000Z',
      categoryId: 'cat-2'
    })

    for (const entry of [category, author, post1, post2, post3]) {
      await postWebhook(entry)
    }
  })

  afterEach(() => {
    nock.cleanAll()
  })

  describe('and listing posts', () => {
    it('should return all posts sorted by published date descending', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.total).toBe(3)
      expect(body.items).toHaveLength(3)
      expect(body.items[0].fields.id).toBe('third-post')
      expect(body.items[1].fields.id).toBe('second-post')
      expect(body.items[2].fields.id).toBe('first-post')
    })
  })

  describe('and filtering by category', () => {
    it('should return only posts matching the category', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?category=technology`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.total).toBe(2)
      expect(
        body.items.every((item: Record<string, Record<string, string>>) =>
          ['first-post', 'second-post'].includes(item.fields.id)
        )
      ).toBe(true)
    })
  })

  describe('and filtering by author', () => {
    it('should return all posts by the author', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?author=john-doe`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.total).toBe(3)
    })
  })

  describe('and looking up a post by slug', () => {
    it('should return a single matching post', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?slug=second-post`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.total).toBe(1)
      expect(body.items[0].fields.id).toBe('second-post')
      expect(body.items[0].fields.title).toBe('Second Post')
    })
  })

  describe('and the slug does not exist', () => {
    it('should return an empty result', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?slug=nonexistent-post`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.total).toBe(0)
      expect(body.items).toHaveLength(0)
    })
  })

  describe('and paginating results', () => {
    it('should respect limit and skip while reporting the full total', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?limit=1&skip=1`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.total).toBe(3)
      expect(body.items).toHaveLength(1)
      expect(body.items[0].fields.id).toBe('second-post')
      expect(body.skip).toBe(1)
      expect(body.limit).toBe(1)
    })
  })

  describe('and requesting a specific locale', () => {
    it('should localize the response fields', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?slug=test-post-es&locale=es`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.items[0].fields.title).toBe('Publicación de Prueba')
      expect(body.items[0].sys.locale).toBe('es')
    })
  })

  describe('and listing categories', () => {
    it('should return categories sorted by title', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/categories`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.items).toHaveLength(1)
      expect(body.items[0].fields.id).toBe('technology')
    })
  })

  describe('and listing authors', () => {
    it('should return authors', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/authors`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.items).toHaveLength(1)
      expect(body.items[0].fields.id).toBe('john-doe')
    })
  })

  describe('and the space does not match', () => {
    it('should return 404', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/wrong-space/environments/${TEST_ENVIRONMENT}/blog/posts`
      )
      expect(response.status).toBe(404)
    })
  })

  describe('and the blog type is invalid', () => {
    it('should return 400', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/invalid`
      )
      expect(response.status).toBe(400)
    })
  })

  describe('and the locale is invalid', () => {
    it('should return 400', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?locale=xx-INVALID`
      )
      expect(response.status).toBe(400)
    })
  })
})
