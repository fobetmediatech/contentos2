/**
 * Column-drift guard for the cb_ tables.
 *
 * WHY THIS EXISTS: PostgREST queries name tables and columns as plain STRINGS. TypeScript cannot
 * type them, ESLint has nothing to flag, and unit tests pass because none of them touch a database.
 * So a query referencing a column that does not exist compiles, lints and tests completely clean —
 * then fails at runtime, in production, on first use.
 *
 * That is not hypothetical: `cb_transcripts.title` was selected by three separate queries while the
 * migration never created it. Every static check in this repo passed. It was caught only by
 * dry-running the migration by hand.
 *
 * This test closes that gap without needing a database: it parses the migrations for the columns
 * that actually exist, extracts every column the app references, and cross-checks them.
 *
 * If it fails, one of two things is true — the migration is missing a column, or a query has a
 * typo. Both are real bugs; neither is a reason to weaken this test.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '../..')
const MIGRATIONS = join(ROOT, 'supabase/migrations')

/** Reserved words that begin a table CONSTRAINT rather than a column definition. */
const NOT_A_COLUMN = /^(constraint|primary|unique|check|foreign|exclude)\b/i

/**
 * Parse `create table` bodies and `alter table … add column` into table -> Set(columns).
 * Deliberately simple: these migrations are hand-written in a consistent style, and a real SQL
 * parser would be far more machinery than the problem needs.
 */
function columnsFromMigrations(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>()
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')

    // create table [if not exists] <name> ( ... );
    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\);/gi
    let m: RegExpExecArray | null
    while ((m = createRe.exec(sql)) !== null) {
      const table = m[1].toLowerCase()
      const cols = tables.get(table) ?? new Set<string>()
      for (const rawLine of m[2].split('\n')) {
        const line = rawLine.trim().replace(/--.*$/, '').trim()
        if (!line || NOT_A_COLUMN.test(line)) continue
        const col = line.match(/^([a-z_][a-z0-9_]*)\s+\S/i)
        if (col) cols.add(col[1].toLowerCase())
      }
      tables.set(table, cols)
    }

    // alter table <name> add column [if not exists] <col>
    const alterRe = /alter\s+table\s+([a-z_][a-z0-9_]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi
    while ((m = alterRe.exec(sql)) !== null) {
      const table = m[1].toLowerCase()
      const cols = tables.get(table) ?? new Set<string>()
      cols.add(m[2].toLowerCase())
      tables.set(table, cols)
    }
  }
  return tables
}

interface Reference { file: string; table: string; column: string }

/** Split a PostgREST select list, pulling nested `other_table(col,col)` out as its own references. */
function parseSelect(table: string, select: string, file: string, out: Reference[]): void {
  // Nested relations first, then remove them so the outer split is clean.
  const nested = /([a-z_][a-z0-9_]*)\(([^)]*)\)/gi
  let m: RegExpExecArray | null
  let rest = select
  while ((m = nested.exec(select)) !== null) {
    for (const c of m[2].split(',')) {
      const col = c.trim()
      if (col && col !== '*') out.push({ file, table: m[1].toLowerCase(), column: col.toLowerCase() })
    }
    rest = rest.replace(m[0], '')
  }
  for (const c of rest.split(',')) {
    const col = c.trim()
    if (col && col !== '*') out.push({ file, table, column: col.toLowerCase() })
  }
}

/** Every cb_ column referenced by app code, from both query styles in use. */
function referencedColumns(): Reference[] {
  const out: Reference[] = []
  const files = [
    ...readdirSync(join(ROOT, 'api')).filter((f) => f.endsWith('.ts') && !f.includes('.test.')).map((f) => join('api', f)),
    // The real query bodies live in _lib/handler*.ts — they were moved out of api/ so they stop
    // counting against Vercel's 12-function cap. Scanning only api/ root would silently stop
    // guarding them, which is exactly the drift this test exists to catch.
    ...readdirSync(join(ROOT, 'api/_lib'))
      .filter((f) => f.startsWith('handler') && f.endsWith('.ts') && !f.includes('.test.'))
      .map((f) => join('api', '_lib', f)),
    join('src', 'lib', 'reviewRepo.ts'),
  ]

  for (const rel of files) {
    let src: string
    try { src = readFileSync(join(ROOT, rel), 'utf8') } catch { continue }

    // Style 1 — PostgREST REST path: `cb_table?select=a,b,c` (plus &filters)
    const restRe = /(cb_[a-z_]+)\?([^`'"\s]+)/g
    let m: RegExpExecArray | null
    while ((m = restRe.exec(src)) !== null) {
      const table = m[1].toLowerCase()
      for (const param of m[2].split('&')) {
        const [rawKey, rawVal] = param.split('=')
        const key = rawKey?.trim()
        if (!key) continue
        if (key === 'select' && rawVal) {
          parseSelect(table, rawVal, rel, out)
        } else if (key === 'order' && rawVal) {
          // order can be multi-column with optional direction: `a,b.desc` — comma first, then dot.
          for (const part of rawVal.split(',')) {
            const col = part.split('.')[0].trim()
            if (col) out.push({ file: rel, table, column: col.toLowerCase() })
          }
        } else if (/^[a-z_][a-z0-9_]*$/.test(key) && key !== 'on_conflict' && key !== 'limit') {
          // A filter like client_id=eq.x — the key is a column name.
          out.push({ file: rel, table, column: key.toLowerCase() })
        }
      }
    }

    // Style 2 — supabase-js: .from('cb_table') … .select('a,b,c')
    const fromRe = /\.from\((['"`])(cb_[a-z_]+)\1\)([\s\S]{0,400})/g
    while ((m = fromRe.exec(src)) !== null) {
      const table = m[2].toLowerCase()
      const tail = m[3]
      const sel = tail.match(/\.select\((['"`])([^'"`]+)\1\)/)
      if (sel) parseSelect(table, sel[2], rel, out)
      for (const eq of tail.matchAll(/\.(?:eq|in|gte|lte|lt|gt|neq)\((['"`])([a-z_][a-z0-9_]*)\1/g)) {
        out.push({ file: rel, table, column: eq[2].toLowerCase() })
      }
    }
  }
  return out
}

describe('cb_ column drift', () => {
  const schema = columnsFromMigrations()
  const refs = referencedColumns()

  it('parsed the migrations and found the cb_ tables', () => {
    // Guards the guard: a broken parser would make every assertion below vacuously pass.
    for (const t of ['cb_clients', 'cb_client_emails', 'cb_transcripts', 'cb_transcript_chunks', 'cb_extractions']) {
      expect(schema.get(t), `${t} not parsed from migrations`).toBeTruthy()
    }
    expect(schema.get('cb_transcripts')!.has('title')).toBe(true) // the column that shipped missing
    expect(schema.get('cb_extractions')!.has('citations')).toBe(true)
  })

  it('found the queries it is meant to check', () => {
    expect(refs.length).toBeGreaterThan(15)
    expect(new Set(refs.map((r) => r.file)).size).toBeGreaterThan(1)
  })

  it('every referenced cb_ column exists in the schema', () => {
    const missing = refs.filter((r) => {
      const cols = schema.get(r.table)
      return cols ? !cols.has(r.column) : true
    })

    expect(
      missing.map((r) => `${r.table}.${r.column}  (${r.file})`),
      'columns referenced by app code but absent from the migrations',
    ).toEqual([])
  })
})
