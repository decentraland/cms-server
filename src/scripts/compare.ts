/**
 * Comparison script: hits both the CMS lambda and the CMS server with the same
 * requests and reports any differences in status codes, headers, or response bodies.
 *
 * Usage:
 *   npx ts-node src/scripts/compare.ts
 *
 * Optional environment variables:
 *   LAMBDA_BASE_URL  - Lambda URL  (default: https://cms.decentraland.org)
 *   SERVER_BASE_URL  - Server URL  (default: https://cms-api.decentraland.org)
 */

const LAMBDA = (process.env.LAMBDA_BASE_URL || 'https://cms.decentraland.org').replace(/\/$/, '')
const SERVER = (process.env.SERVER_BASE_URL || 'https://cms-api.decentraland.org').replace(/\/$/, '')

const SPACE = 'ea2ybdmmn1kv'
const ENV = 'master'
const BASE = `/spaces/${SPACE}/environments/${ENV}`

// --- Types ---

interface CompareResult {
  path: string
  passed: boolean
  differences: string[]
  lambdaStatus: number
  serverStatus: number
  lambdaTime: number
  serverTime: number
}

// --- Paths to test ---

function getTestPaths(): Array<{ path: string; description: string }> {
  return [
    // Locales
    { path: `${BASE}/locales`, description: 'Locales' },

    // Blog listings
    { path: `${BASE}/blog/posts`, description: 'Blog posts (default params)' },
    { path: `${BASE}/blog/posts?locale=en-US`, description: 'Blog posts (en-US)' },
    { path: `${BASE}/blog/posts?locale=es`, description: 'Blog posts (es)' },
    { path: `${BASE}/blog/posts?locale=zh`, description: 'Blog posts (zh)' },
    { path: `${BASE}/blog/posts?limit=5`, description: 'Blog posts (limit=5)' },
    { path: `${BASE}/blog/posts?limit=5&skip=5`, description: 'Blog posts (limit=5, skip=5)' },
    { path: `${BASE}/blog/categories`, description: 'Blog categories' },
    { path: `${BASE}/blog/categories?locale=es`, description: 'Blog categories (es)' },
    { path: `${BASE}/blog/authors`, description: 'Blog authors' },
    { path: `${BASE}/blog/authors?locale=es`, description: 'Blog authors (es)' },

    // Invalid blog type
    { path: `${BASE}/blog/invalid`, description: 'Blog invalid type (expect 400)' },

    // Invalid locale
    { path: `${BASE}/blog/posts?locale=fr`, description: 'Blog posts invalid locale (expect 400)' },

    // Wrong space/environment
    { path: `/spaces/wrong/environments/${ENV}/blog/posts`, description: 'Wrong space (expect 404)' },
    { path: `/spaces/${SPACE}/environments/wrong/blog/posts`, description: 'Wrong environment (expect 404)' },

    // Unknown entry (expect 404)
    { path: `${BASE}/entries/nonexistent-id-12345`, description: 'Unknown entry (expect 404)' },

    // Unknown asset (expect 404)
    { path: `${BASE}/assets/nonexistent-id-12345`, description: 'Unknown asset (expect 404)' }
  ]
}

// --- Comparison logic ---

const HEADERS_TO_COMPARE = ['cache-control', 'content-type']

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== typeof b) return false
  if (typeof a !== 'object') return false

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== (b as unknown[]).length) return false
    return a.every((val, i) => deepEqual(val, (b as unknown[])[i]))
  }

  const keysA = Object.keys(a as Record<string, unknown>).sort()
  const keysB = Object.keys(b as Record<string, unknown>).sort()
  if (keysA.length !== keysB.length || keysA.some((k, i) => k !== keysB[i])) return false
  return keysA.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

function diffObjects(label: string, a: unknown, b: unknown, path = ''): string[] {
  const diffs: string[] = []

  if (a === b) return diffs
  if (a === null || b === null || typeof a !== typeof b) {
    diffs.push(`${label}${path}: lambda=${JSON.stringify(a)} server=${JSON.stringify(b)}`)
    return diffs
  }
  if (typeof a !== 'object') {
    diffs.push(`${label}${path}: lambda=${JSON.stringify(a)} server=${JSON.stringify(b)}`)
    return diffs
  }

  if (Array.isArray(a)) {
    const bArr = b as unknown[]
    if (!Array.isArray(b)) {
      diffs.push(`${label}${path}: lambda=Array server=${typeof b}`)
      return diffs
    }
    if (a.length !== bArr.length) {
      diffs.push(`${label}${path}.length: lambda=${a.length} server=${bArr.length}`)
    }
    const len = Math.min(a.length, bArr.length)
    for (let i = 0; i < len; i++) {
      diffs.push(...diffObjects(label, a[i], bArr[i], `${path}[${i}]`))
    }
    return diffs
  }

  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)])
  for (const key of allKeys) {
    if (!(key in aObj)) {
      diffs.push(`${label}${path}.${key}: missing in lambda, present in server`)
    } else if (!(key in bObj)) {
      diffs.push(`${label}${path}.${key}: present in lambda, missing in server`)
    } else {
      diffs.push(...diffObjects(label, aObj[key], bObj[key], `${path}.${key}`))
    }
  }
  return diffs
}

async function fetchWithTiming(url: string): Promise<{ status: number; headers: Headers; body: string; ms: number }> {
  const start = performance.now()
  const res = await fetch(url)
  const body = await res.text()
  const ms = Math.round(performance.now() - start)
  return { status: res.status, headers: res.headers, body, ms }
}

async function comparePath(testPath: string): Promise<CompareResult> {
  const lambdaUrl = `${LAMBDA}${testPath}`
  const serverUrl = `${SERVER}${testPath}`

  const [lambdaRes, serverRes] = await Promise.all([fetchWithTiming(lambdaUrl), fetchWithTiming(serverUrl)])

  const differences: string[] = []

  // Compare status codes
  if (lambdaRes.status !== serverRes.status) {
    differences.push(`Status: lambda=${lambdaRes.status} server=${serverRes.status}`)
  }

  // Compare selected headers
  for (const header of HEADERS_TO_COMPARE) {
    const lambdaVal = lambdaRes.headers.get(header)
    const serverVal = serverRes.headers.get(header)
    if (lambdaVal !== serverVal) {
      differences.push(`Header "${header}": lambda=${lambdaVal} server=${serverVal}`)
    }
  }

  // Compare body
  let lambdaBody: unknown
  let serverBody: unknown
  try {
    lambdaBody = JSON.parse(lambdaRes.body)
  } catch {
    lambdaBody = lambdaRes.body
  }
  try {
    serverBody = JSON.parse(serverRes.body)
  } catch {
    serverBody = serverRes.body
  }

  // For entry/asset responses, ignore sys.locale if one is set and the other isn't
  // (framework differences), and ignore requestId (always different)
  if (typeof lambdaBody === 'object' && lambdaBody !== null) {
    stripVolatileFields(lambdaBody as Record<string, unknown>)
  }
  if (typeof serverBody === 'object' && serverBody !== null) {
    stripVolatileFields(serverBody as Record<string, unknown>)
  }

  if (!deepEqual(lambdaBody, serverBody)) {
    const bodyDiffs = diffObjects('Body', lambdaBody, serverBody)
    // Cap at 10 diffs to keep output readable
    if (bodyDiffs.length > 10) {
      differences.push(...bodyDiffs.slice(0, 10), `... and ${bodyDiffs.length - 10} more differences`)
    } else {
      differences.push(...bodyDiffs)
    }
  }

  return {
    path: testPath,
    passed: differences.length === 0,
    differences,
    lambdaStatus: lambdaRes.status,
    serverStatus: serverRes.status,
    lambdaTime: lambdaRes.ms,
    serverTime: serverRes.ms
  }
}

function stripVolatileFields(obj: Record<string, unknown>) {
  delete obj.requestId
  if (typeof obj.sys === 'object' && obj.sys !== null) {
    delete (obj.sys as Record<string, unknown>).requestId
  }
  // Recurse into items array (for listing responses)
  if (Array.isArray(obj.items)) {
    for (const item of obj.items) {
      if (typeof item === 'object' && item !== null) {
        stripVolatileFields(item as Record<string, unknown>)
      }
    }
  }
}

// --- Entry/Asset discovery ---

async function discoverEntryIds(): Promise<{ entryIds: string[]; assetIds: string[] }> {
  // Fetch a few blog posts to extract real entry and asset IDs for testing
  const url = `${LAMBDA}${BASE}/blog/posts?limit=3`
  const res = await fetch(url)
  if (!res.ok) return { entryIds: [], assetIds: [] }

  const data = (await res.json()) as { items?: Array<Record<string, Record<string, unknown>>> }
  const entryIds: string[] = []
  const assetIds: string[] = []

  for (const item of data.items || []) {
    const sysId = (item?.sys as Record<string, unknown>)?.id as string | undefined
    if (sysId) {
      entryIds.push(sysId)
    }
    // Extract linked asset IDs from image fields
    const image = (item?.fields as Record<string, unknown>)?.image as
      | Record<string, Record<string, unknown>>
      | undefined
    const imageId = image?.sys?.id as string | undefined
    if (imageId) {
      assetIds.push(imageId)
    }
  }

  return { entryIds, assetIds }
}

// --- Main ---

async function main() {
  console.log(`Comparing responses:`)
  console.log(`  Lambda: ${LAMBDA}`)
  console.log(`  Server: ${SERVER}`)
  console.log()

  // Discover real IDs from lambda
  console.log('Discovering entry/asset IDs from blog posts...')
  const { entryIds, assetIds } = await discoverEntryIds()
  console.log(`  Found ${entryIds.length} entry IDs, ${assetIds.length} asset IDs\n`)

  const testPaths = getTestPaths()

  // Add discovered entries
  for (const id of entryIds) {
    testPaths.push({ path: `${BASE}/entries/${id}`, description: `Entry ${id}` })
    testPaths.push({ path: `${BASE}/entries/${id}?locale=es`, description: `Entry ${id} (es)` })
  }
  for (const id of assetIds) {
    testPaths.push({ path: `${BASE}/assets/${id}`, description: `Asset ${id}` })
  }

  // Discover a category and author slug for filtered queries
  const catRes = await fetch(`${LAMBDA}${BASE}/blog/categories?limit=1`)
  if (catRes.ok) {
    const catData = (await catRes.json()) as { items?: Array<Record<string, Record<string, unknown>>> }
    const catSlug = (catData.items?.[0]?.fields as Record<string, unknown> | undefined)?.id as string | undefined
    if (catSlug) {
      testPaths.push({
        path: `${BASE}/blog/categories?slug=${catSlug}`,
        description: `Categories by slug=${catSlug}`
      })
      testPaths.push({
        path: `${BASE}/blog/posts?category=${catSlug}`,
        description: `Posts by category=${catSlug}`
      })
    }
  }

  const authRes = await fetch(`${LAMBDA}${BASE}/blog/authors?limit=1`)
  if (authRes.ok) {
    const authData = (await authRes.json()) as { items?: Array<Record<string, Record<string, unknown>>> }
    const authSlug = (authData.items?.[0]?.fields as Record<string, unknown> | undefined)?.id as string | undefined
    if (authSlug) {
      testPaths.push({
        path: `${BASE}/blog/authors?slug=${authSlug}`,
        description: `Authors by slug=${authSlug}`
      })
      testPaths.push({
        path: `${BASE}/blog/posts?author=${authSlug}`,
        description: `Posts by author=${authSlug}`
      })
    }
  }

  // Run comparisons
  let passed = 0
  let failed = 0
  const failures: CompareResult[] = []

  for (const test of testPaths) {
    try {
      const result = await comparePath(test.path)
      if (result.passed) {
        console.log(`  PASS  ${test.description} (lambda: ${result.lambdaTime}ms, server: ${result.serverTime}ms)`)
        passed++
      } else {
        console.log(`  FAIL  ${test.description}`)
        for (const diff of result.differences) {
          console.log(`        ${diff}`)
        }
        failed++
        failures.push(result)
      }
    } catch (err: unknown) {
      console.log(`  ERROR ${test.description}: ${(err as Error).message}`)
      failed++
    }
  }

  // Summary
  console.log('\n════════════════════════════════════════')
  console.log(`Results: ${passed} passed, ${failed} failed, ${testPaths.length} total`)
  if (failures.length > 0) {
    console.log('\nFailed paths:')
    for (const f of failures) {
      console.log(`  ${f.path}`)
    }
  }
  console.log('════════════════════════════════════════')

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Comparison failed:', err)
  process.exit(1)
})
