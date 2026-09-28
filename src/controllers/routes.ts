import { Router } from '@dcl/http-server'
import { blogHandler, blogUrlsHandler } from './handlers/blog-handler'
import { entryHandler, localesHandler } from './handlers/entry-handler'
import { pingHandler } from './handlers/ping-handler'
import { bulkSyncHandler, singleEntrySyncHandler } from './handlers/sync-handler'
import { webhookHandler } from './handlers/webhook-handler'
import type { GlobalContext } from '../types'

// We return the entire router because it will be easier to test than a whole server
export async function setupRouter(_: GlobalContext): Promise<Router<GlobalContext>> {
  const router = new Router<GlobalContext>()

  // Health check
  router.get('/ping', pingHandler)

  // Webhook (Contentful -> DB)
  router.post('/webhook', webhookHandler)

  // Locales
  router.get('/spaces/:space/environments/:environment/locales', localesHandler)

  // Blog URL index. Registered before `/blog/:type` or that route claims `urls` and rejects it.
  router.get('/spaces/:space/environments/:environment/blog/urls', blogUrlsHandler)

  // Blog listing (posts, categories, authors)
  router.get('/spaces/:space/environments/:environment/blog/:type', blogHandler)

  // Individual entry/asset retrieval
  router.get('/spaces/:space/environments/:environment/:types/:id', entryHandler)

  // Sync: single entry
  router.post('/spaces/:space/environments/:environment/blog/sync/entry/:entry_id', singleEntrySyncHandler)

  // Sync: bulk (all blog content)
  router.post('/spaces/:space/environments/:environment/blog/sync', bulkSyncHandler)

  return router
}
