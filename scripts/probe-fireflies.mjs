/**
 * Fireflies API probe — answers the Phase 2 questions that docs can't.
 *
 * Does NOT print your API key, and does NOT print transcript bodies. It reports only the SHAPE
 * of what your plan returns, plus a redacted sample to confirm the fields exist.
 *
 * THE QUESTION THIS EXISTS TO ANSWER: can a transcript be matched to a CLIENT?
 * That needs an EXTERNAL participant email (the client's). An internal address — your own
 * notetaker bot or a teammate — is worthless as a join key, so this script classifies emails by
 * domain rather than merely counting them. "An email is present" is not the same claim as
 * "the client's email is present", and an earlier version of this probe conflated the two.
 *
 * Also reports `calendar_id`: a link-joined meeting has no calendar event behind it, therefore no
 * attendee list, therefore no client email. That field is the root-cause tell.
 *
 * Usage — key goes in .env (server-side name, NO VITE_ prefix so it can't reach the browser):
 *   echo 'FIREFLIES_API_KEY=your-key-here' >> .env
 *   node --env-file=.env scripts/probe-fireflies.mjs
 */

const KEY = process.env.FIREFLIES_API_KEY
if (!KEY) {
  console.error('FIREFLIES_API_KEY not set. Add it to .env, then run with --env-file=.env')
  process.exit(1)
}

const gql = async (query) => {
  const res = await fetch('https://api.fireflies.ai/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) {
    console.error(`\n❌ HTTP ${res.status} ${res.statusText} — key wrong, or API off for this plan.`)
    process.exit(1)
  }
  const body = await res.json()
  if (body.errors) {
    console.error('\n❌ GraphQL errors:')
    for (const e of body.errors) console.error(`   - ${e.message}`)
    process.exit(1)
  }
  return body.data
}

const redact = (e) => {
  if (typeof e !== 'string' || !e.includes('@')) return String(e)
  const [user, domain] = e.split('@')
  return `${user.slice(0, 2)}***@${domain}`
}
const domainOf = (e) => (typeof e === 'string' && e.includes('@') ? e.split('@')[1].toLowerCase() : null)

// --- Who are we, and what counts as "internal"? -----------------------------------------------
const me = (await gql(`{ users { name email is_admin num_transcripts is_calendar_in_sync } }`)).users ?? []
const internalDomains = new Set(me.map((u) => domainOf(u.email)).filter(Boolean))

console.log(`\nWorkspace users visible to this key: ${me.length}`)
for (const u of me) {
  console.log(`  ${u.name} <${redact(u.email)}>  admin=${u.is_admin}  transcripts=${u.num_transcripts}  calendar_in_sync=${u.is_calendar_in_sync}`)
}
console.log(`Treating as INTERNAL: ${[...internalDomains].join(', ') || '(none)'}`)

// --- Transcripts ------------------------------------------------------------------------------
const data = await gql(`{
  transcripts(limit: 10) {
    id title date duration calendar_id
    organizer_email participants
    meeting_attendees { displayName email }
    sentences { speaker_name start_time }
  }
}`)

const list = data.transcripts ?? []
console.log(`\n✅ Authenticated. Returned ${list.length} transcript(s).\n`)
if (!list.length) {
  console.log('No transcripts yet — record a meeting, then re-run.')
  process.exit(0)
}

let anyExternal = false
let anyCalendar = false
let anyStart = false
let anySpeaker = false

for (const t of list) {
  const emails = [
    ...(t.meeting_attendees ?? []).map((a) => a?.email),
    ...(Array.isArray(t.participants) ? t.participants : [t.participants]),
    t.organizer_email,
  ].filter((e) => typeof e === 'string' && e.includes('@'))

  const uniq = [...new Set(emails.map((e) => e.toLowerCase()))]
  const external = uniq.filter((e) => !internalDomains.has(domainOf(e)))
  const internal = uniq.filter((e) => internalDomains.has(domainOf(e)))

  if (external.length) anyExternal = true
  if (t.calendar_id) anyCalendar = true
  const s = t.sentences?.[0]
  if (s?.start_time != null) anyStart = true
  if (s?.speaker_name) anySpeaker = true

  console.log(`— "${t.title ?? '(untitled)'}"`)
  console.log(`   id=${t.id}`)
  console.log(`   date=${new Date(Number(t.date)).toISOString().slice(0, 16)}  duration=${t.duration} (MINUTES — ingest must ×60)`)
  console.log(`   calendar_id=${t.calendar_id ?? 'null  ⚠️  link-joined, no attendee list'}`)
  console.log(`   internal emails: ${internal.map(redact).join(', ') || '—'}`)
  console.log(`   EXTERNAL emails: ${external.length ? external.map(redact).join(', ') : '⚠️  NONE — cannot match a client'}`)
  console.log(`   sentences=${t.sentences?.length ?? 0}  speaker=${s?.speaker_name ?? '—'}  start_time=${s?.start_time ?? '—'}`)
}

console.log('\n=== VERDICT ===')
console.log(`EXTERNAL (client) email present : ${anyExternal ? 'YES ✅  join key viable' : 'NO  ❌  BLOCKER — no client email to join on'}`)
console.log(`calendar-sourced meeting present: ${anyCalendar ? 'YES ✅' : 'NO  ⚠️  every meeting was link-joined'}`)
console.log(`sentence start_time present     : ${anyStart ? 'YES ✅' : 'NO  ⚠️  citations not clickable'}`)
console.log(`speaker labels present          : ${anySpeaker ? 'YES ✅' : 'NO  ⚠️  cannot chunk on turns'}`)

if (!anyExternal) {
  console.log('\nTo fix: create the call as a Google CALENDAR EVENT and invite BOTH the client')
  console.log('and the notetaker address as attendees — do not just paste the Meet link to the bot.')
}
