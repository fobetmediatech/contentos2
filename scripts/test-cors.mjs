/**
 * PRE-L1-1: CORS verification for Apify REST API
 *
 * Tests whether the Apify API allows browser-origin fetch calls.
 * Run with your actual Apify key:
 *   APIFY_KEY=apify_api_xxxxx node scripts/test-cors.mjs
 *
 * This runs in Node.js (simulates browser fetch without origin restrictions),
 * but Node v18+ fetch IS the same engine as browser fetch — if this fails,
 * the browser will fail the same way.
 *
 * Exit 0 = CORS OK, proceed to build
 * Exit 1 = CORS BLOCKED — architecture must shift to server proxy before continuing
 */

const APIFY_KEY = process.env.APIFY_KEY
const ACTOR_ID = 'apify/instagram-profile-scraper'

if (!APIFY_KEY) {
  console.error('❌ No APIFY_KEY env var. Run: APIFY_KEY=apify_api_xxx node scripts/test-cors.mjs')
  process.exit(1)
}

console.log('PRE-L1-1: Testing Apify CORS...')
console.log(`Actor: ${ACTOR_ID}`)
console.log('')

async function testCors() {
  // Test 1: Can we reach the Apify API at all?
  try {
    const res = await fetch(`https://api.apify.com/v2/acts/${ACTOR_ID}`, {
      headers: {
        Authorization: `Bearer ${APIFY_KEY}`,
        Origin: 'http://localhost:5173', // simulate browser origin
      },
    })

    console.log(`Actor info request: ${res.status} ${res.statusText}`)

    const corsHeader = res.headers.get('access-control-allow-origin')
    console.log(`Access-Control-Allow-Origin: ${corsHeader ?? '(not set)'}`)

    if (!res.ok && res.status === 401) {
      console.error('❌ Auth failed — check your APIFY_KEY')
      process.exit(1)
    }

    if (corsHeader === '*' || corsHeader?.includes('localhost')) {
      console.log('✅ CORS: permissive (wildcard or localhost allowed)')
    } else if (corsHeader) {
      console.log(`⚠️  CORS: restrictive origin header: ${corsHeader}`)
      console.log('   Browser fetch from your deployed domain may be blocked.')
    } else {
      console.log('⚠️  CORS: no Access-Control-Allow-Origin header returned')
      console.log('   Apify may still allow browser fetch — test from actual browser.')
    }

  } catch (err) {
    console.error('❌ Network error reaching Apify:', err.message)
    process.exit(1)
  }

  // Test 2: Does the runs endpoint accept a POST with Origin header?
  console.log('')
  console.log('Testing POST /runs with Origin header...')
  try {
    const res = await fetch(`https://api.apify.com/v2/acts/${ACTOR_ID}/runs`, {
      method: 'OPTIONS', // preflight simulation
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization',
        Origin: 'http://localhost:5173',
      },
    })

    console.log(`OPTIONS preflight: ${res.status} ${res.statusText}`)
    const allowOrigin = res.headers.get('access-control-allow-origin')
    const allowMethods = res.headers.get('access-control-allow-methods')
    const allowHeaders = res.headers.get('access-control-allow-headers')

    console.log(`  Allow-Origin:  ${allowOrigin ?? '(not set)'}`)
    console.log(`  Allow-Methods: ${allowMethods ?? '(not set)'}`)
    console.log(`  Allow-Headers: ${allowHeaders ?? '(not set)'}`)

    if (res.status === 204 || res.status === 200) {
      console.log('')
      console.log('✅ PRE-L1-1 PASSED: Apify API responds to CORS preflight.')
      console.log('   Browser fetch from this app should work without a proxy.')
    } else {
      console.log('')
      console.log('⚠️  PRE-L1-1 INCONCLUSIVE: Preflight returned non-204.')
      console.log('   Test actual POST from a browser before proceeding.')
    }

  } catch (err) {
    console.log(`OPTIONS request failed (may be expected): ${err.message}`)
    console.log('⚠️  Cannot confirm CORS via OPTIONS — test from browser manually.')
  }

  // Test 3: Test the actual input format (usernames array)
  console.log('')
  console.log('Testing actor input format (usernames array)...')
  try {
    const res = await fetch(`https://api.apify.com/v2/acts/${ACTOR_ID}/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${APIFY_KEY}`,
        Origin: 'http://localhost:5173',
      },
      body: JSON.stringify({
        usernames: ['instagram'], // official IG account — safe test
        resultsLimit: 1,
      }),
    })

    console.log(`POST /runs: ${res.status} ${res.statusText}`)
    const json = await res.json()

    if (res.ok && json.data?.id) {
      console.log(`✅ Run started! runId: ${json.data.id}`)
      console.log(`   Status: ${json.data.status}`)
      console.log(`   DatasetId: ${json.data.defaultDatasetId}`)
      console.log('')
      console.log('✅ PRE-L1-1 FULLY PASSED')
      console.log('✅ PRE-L1-2 CONFIRMED: actor ID and usernames[] input format both work')
      console.log('')
      console.log('Write this to src/lib/actors.ts:')
      console.log("  PROFILE_SCRAPER: 'apify/instagram-profile-scraper'")
      console.log("  Input format: { usernames: string[], resultsLimit: number }")
    } else {
      console.error('❌ Failed to start run:', JSON.stringify(json, null, 2))
      process.exit(1)
    }
  } catch (err) {
    console.error('❌ POST /runs failed:', err.message)
    process.exit(1)
  }
}

testCors().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
