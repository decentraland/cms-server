import type { ILoggerComponent } from '@well-known-components/interfaces'

/**
 * Rewrites a Contentful asset URL to the corresponding Decentraland CDN hostname.
 * Handles protocol-relative URLs (`//`) and upgrades `http://` to `https://`.
 *
 * Hostname mapping:
 * - `images.ctfassets.net` / `images.contentful.com` -> `cms-images.decentraland.org`
 * - `videos.ctfassets.net` / `videos.contentful.com` -> `cms-videos.decentraland.org`
 * - `assets.ctfassets.net` / `assets.contentful.com` -> `cms-assets.decentraland.org`
 * - `downloads.ctfassets.net` / `downloads.contentful.com` -> `cms-downloads.decentraland.org`
 *
 * @param url - The original Contentful asset URL.
 * @param logger - Optional logger for warning on unknown hostnames.
 * @returns The URL with the hostname replaced, or the original URL if the hostname is unrecognized.
 */
export function toDecentralandCDNUrl(url: string, logger?: ILoggerComponent.ILogger): string {
  if (url.startsWith('//')) {
    url = `https:${url}`
  }

  if (url.startsWith('http://')) {
    url = url.replace('http://', 'https://')
  }

  const cacheUrl = new URL(url)
  switch (cacheUrl.hostname) {
    case 'images.ctfassets.net':
    case 'images.contentful.com':
      cacheUrl.hostname = 'cms-images.decentraland.org'
      return cacheUrl.toString()
    case 'videos.ctfassets.net':
    case 'videos.contentful.com':
      cacheUrl.hostname = 'cms-videos.decentraland.org'
      return cacheUrl.toString()
    case 'assets.ctfassets.net':
    case 'assets.contentful.com':
      cacheUrl.hostname = 'cms-assets.decentraland.org'
      return cacheUrl.toString()
    case 'downloads.ctfassets.net':
    case 'downloads.contentful.com':
      cacheUrl.hostname = 'cms-downloads.decentraland.org'
      return cacheUrl.toString()
    default:
      if (logger) logger.warn('Unknown contentful asset URL hostname', { url })
      return cacheUrl.toString()
  }
}
