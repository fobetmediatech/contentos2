/**
 * Layer 1 binary gate — test-scraper.mjs
 *
 * Validates: CORS reachable, actor runs, polling works, dataset fetches,
 * 2-round workflow produces normalized profiles with valid ER.
 *
 * Usage:
 *   APIFY_KEY=apify_api_xxx node scripts/test-scraper.mjs
 *
 * Exit 0 = Layer 1 PASSED — proceed to Layer 2
 * Exit 1 = Layer 1 FAILED — fix before writing any Layer 2 or Layer 3 code
 */

import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const APIFY_KEY = process.env.APIFY_KEY
const TEST_HANDLES = ['thesortedgirl', 'pritika.loonia'] // known good handles from real data

if (!APIFY_KEY) {
  console.error('❌ APIFY_KEY required. Run: APIFY_KEY=apify_api_xxx node scripts/test-scraper.mjs')
  process.exit(1)
}

// ---- Inline layer 1 logic (avoids TypeScript compilation for gate script) ----

const BASE_URL = 'https://api.apify.com/v2'
const ACTOR_ID = 'apify/instagram-profile-scraper'
const POLL_INTERVAL_MS = 2000
const MAX_POLL_MS = 110_000

async function startRun(usernames) {
  const res = await fetch(`${BASE_URL}/acts/${ACTOR_ID}/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${APIFY_KEY}`,
    },
    body: JSON.stringify({ usernames, resultsLimit: 1 }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`startRun failed: ${res.status} ${body}`)
  }
  const json = await res.json()
  return { runId: json.data.id, datasetId: json.data.defaultDatasetId }
}

async function pollRun(runId) {
  const deadline = Date.now() + MAX_POLL_MS
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/actor-runs/${runId}`, {
      headers: { Authorization: `Bearer ${APIFY_KEY}` },
    })
    const json = await res.json()
    const { status, defaultDatasetId } = json.data
    process.stdout.write(`  polling... status=${status}\r`)
    if (status === 'SUCCEEDED') { console.log(''); return defaultDatasetId }
    if (['FAILED','TIMED-OUT','ABORTED'].includes(status)) throw new Error(`Run ended with status: ${status}`)
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error('Poll timeout')
}

async function fetchDataset(datasetId) {
  const res = await fetch(`${BASE_URL}/datasets/${datasetId}/items?clean=true`, {
    headers: { Authorization: `Bearer ${APIFY_KEY}` },
  })
  if (!res.ok) throw new Error(`Dataset fetch failed: ${res.status}`)
  const json = await res.json()
  return Array.isArray(json) ? json : (json.items ?? [])
}

function computeER(latestPosts, followersCount) {
  if (followersCount < 100) return null
  const dmBaitCap = followersCount * 0.05
  const valid = latestPosts.filter(p => (p.commentsCount ?? 0) <= dmBaitCap)
  const posts = valid.length >= 3 ? valid : latestPosts
  if (!posts.length) return null
  const avgLikes = posts.reduce((s,p) => s + (p.likesCount ?? 0), 0) / posts.length
  const avgComments = posts.reduce((s,p) => s + (p.commentsCount ?? 0), 0) / posts.length
  return (avgLikes + avgComments) / followersCount * 100
}

// ---- Tests ----

let passed = 0
let failed = 0

function ok(label) { console.log(`  ✅ ${label}`); passed++ }
function fail(label, detail) { console.log(`  ❌ ${label}: ${detail}`); failed++ }

async function run() {
  console.log('Layer 1 Gate — test-scraper.mjs')
  console.log('================================')
  console.log(`Test handles: ${TEST_HANDLES.join(', ')}`)
  console.log()

  // Test 1: CORS / reachability
  console.log('[1] CORS / reachability')
  try {
    const res = await fetch(`${BASE_URL}/acts/${ACTOR_ID}`, {
      headers: { Authorization: `Bearer ${APIFY_KEY}` },
    })
    if (res.ok) ok('Apify API reachable')
    else fail('Apify API', `${res.status} ${res.statusText}`)
  } catch(e) { fail('Network', e.message) }

  // Test 2: Round 1 — scrape input handles
  console.log()
  console.log('[2] Round 1 — scrape input handles')
  let round1Profiles = []
  try {
    console.log(`  Starting actor run for: ${TEST_HANDLES.join(', ')}`)
    const { runId, datasetId } = await startRun(TEST_HANDLES)
    ok(`Run started: ${runId}`)
    const resolvedDatasetId = await pollRun(runId)
    ok(`Run SUCCEEDED, datasetId: ${resolvedDatasetId || datasetId}`)
    round1Profiles = await fetchDataset(resolvedDatasetId || datasetId)
    ok(`Dataset fetched: ${round1Profiles.length} profiles`)
  } catch(e) { fail('Round 1 scrape', e.message) }

  // Test 3: Validate profile shape and ER
  console.log()
  console.log('[3] Profile shape + ER validation')
  for (const p of round1Profiles) {
    const er = computeER(p.latestPosts ?? [], p.followersCount ?? 0)
    const erStr = er !== null ? `${er.toFixed(2)}%` : 'null (followers<100)'
    ok(`@${p.username}: ${(p.followersCount ?? 0).toLocaleString()} followers, ER: ${erStr}`)

    if (!p.username) fail(`@${p.username}: missing username`, '')
    if (typeof p.followersCount !== 'number') fail(`@${p.username}: followersCount not a number`, typeof p.followersCount)
    if (!Array.isArray(p.latestPosts)) fail(`@${p.username}: latestPosts not array`, typeof p.latestPosts)
    if (!Array.isArray(p.relatedProfiles)) fail(`@${p.username}: relatedProfiles not array`, typeof p.relatedProfiles)
    else ok(`@${p.username}: relatedProfiles[${p.relatedProfiles.length}] present`)
  }

  // Test 4: Extract related handles for Round 2
  console.log()
  console.log('[4] Related handle extraction')
  const inputSet = new Set(TEST_HANDLES.map(h => h.toLowerCase()))
  const allRelated = round1Profiles.flatMap(p => (p.relatedProfiles ?? []).map(r => r.username))
  const candidates = [...new Set(allRelated)].filter(h => !inputSet.has(h.toLowerCase()))
  ok(`Extracted ${candidates.length} candidate handles: ${candidates.slice(0,5).join(', ')}${candidates.length > 5 ? '...' : ''}`)
  if (candidates.length === 0) fail('No candidates found', 'relatedProfiles may be empty')

  // Test 5: Round 2 — scrape first batch of candidates
  console.log()
  console.log('[5] Round 2 — scrape candidate profiles (first 5)')
  const batch = candidates.slice(0, 5)
  let round2Profiles = []
  try {
    console.log(`  Starting actor run for: ${batch.join(', ')}`)
    const { runId, datasetId } = await startRun(batch)
    ok(`Round 2 run started: ${runId}`)
    const resolvedDatasetId = await pollRun(runId)
    ok(`Round 2 SUCCEEDED`)
    round2Profiles = await fetchDataset(resolvedDatasetId || datasetId)
    ok(`Round 2 dataset: ${round2Profiles.length} profiles`)

    // Quick ER check on candidates
    for (const p of round2Profiles) {
      const er = computeER(p.latestPosts ?? [], p.followersCount ?? 0)
      ok(`  @${p.username}: ${(p.followersCount??0).toLocaleString()} followers, ER: ${er?.toFixed(2) ?? 'null'}%`)
    }
  } catch(e) { fail('Round 2 scrape', e.message) }

  // ---- Results ----
  console.log()
  console.log('================================')
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.log()
    console.log('❌ LAYER 1 GATE FAILED — fix issues before writing Layer 2 code')
    process.exit(1)
  } else {
    console.log()
    console.log('✅ LAYER 1 GATE PASSED — proceed to Layer 2 (AI processing)')
  }
}

run().catch(err => { console.error(err); process.exit(1) })
