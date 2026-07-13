/**
 * useContentStrategy — orchestrates the Content Strategizing pipeline:
 *   1. Competitor landscape  : discoverCompetitors(seeds) → seed metrics + discovered accounts
 *   2. Aspirational metrics   : scrapeHandles(aspirational)
 *   3. HookMap (deep reels)   : top competitors + all aspirational → per-creator hook summaries
 *   4. Synthesis              : analyzeContentStrategy(brief + analysis) → ContentStrategyDoc
 *
 * Reuses the existing competitor + reel-HookMap libs directly (no reel-store writes, so it never
 * collides with the chat's reel run). All heavy work happens via the Clerk-gated /api proxies, so
 * the generation only runs on the deployed app (the /api functions don't run under plain dev).
 */
import { useRef } from 'react'
import pLimit from 'p-limit'
import { useKeysStore } from '../store/keysStore'
import { useStrategyStore } from '../store/strategyStore'
import { discoverCompetitors, scrapeHandles } from '../lib/apifyClient'
import { scrapeTopReels } from '../lib/reelScraper'
import { scrapeReelVideos } from '../lib/reelVideoClient'
import { analyzeReelHookmap, singleReelFnAvailable } from '../lib/reelHookmap'
import { synthesizeCreatorHooks } from '../lib/reelAnalyzer'
import { analyzeContentStrategy } from '../ai/gemini'
import { devWarn } from '../lib/devLog'
import type { NormalizedProfile } from '../lib/transformers'
import type { SingleReelResult } from '../domain/reel'
import type { CreatorHookSummary } from '../ai/prompts/creatorHookSummary'
import type { StrategyBrief, AnalyzedAccount } from '../domain/strategy'

const HOOKMAP_COMPETITORS = 3 // top-N competitors to deep-analyse (plus ALL aspirational)
const creatorLimit = pLimit(2) // creators analysed in parallel
const reelLimit = pLimit(3)    // reels per creator

const clean = (h: string) => h.trim().replace(/^@/, '').toLowerCase()

function toAccount(p: NormalizedProfile, source: AnalyzedAccount['source']): AnalyzedAccount {
  return {
    username: p.username,
    fullName: p.fullName,
    followers: p.followersCount,
    engagementRate: p.engagementRate,
    verified: p.verified,
    source,
    profilePicUrl: p.profilePicUrl,
  }
}

/** Deep-HookMap one creator → CreatorHookSummary (no reel-store writes). Null on failure/no reels. */
async function analyzeCreatorHooks(
  handle: string,
  apifyKeys: string[],
  geminiKeys: string[],
  signal: AbortSignal,
): Promise<CreatorHookSummary | null> {
  try {
    const reels = await scrapeTopReels(handle, 10, apifyKeys, signal)
    if (signal.aborted || reels.length === 0) return null
    const videos = await scrapeReelVideos(reels.map((r) => r.url), apifyKeys, signal)
    if (signal.aborted) return null
    const caseStudies: Record<string, SingleReelResult> = {}
    await Promise.all(
      reels.map((reel) =>
        reelLimit(async () => {
          if (signal.aborted) return
          const url = videos.get(reel.shortCode)
          if (!url) return
          const result = await analyzeReelHookmap(handle, reel, url, signal)
          if (result) caseStudies[reel.shortCode] = result
        }),
      ),
    )
    if (signal.aborted || Object.keys(caseStudies).length === 0) return null
    return await synthesizeCreatorHooks(handle, caseStudies, reels, geminiKeys, signal)
  } catch (err) {
    devWarn(`[strategy] hook analysis failed for @${handle}:`, err)
    return null
  }
}

export function useContentStrategy() {
  const { apifyKeys, geminiKeys } = useKeysStore()
  const { start, setStep, setResult, setError } = useStrategyStore()
  const abortRef = useRef<AbortController | null>(null)

  const cancel = () => abortRef.current?.abort()

  const generate = async (brief: StrategyBrief) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const signal = controller.signal

    const competitors = brief.competitors.map(clean).filter(Boolean)
    const aspirational = brief.aspirational.map(clean).filter(Boolean)
    if (competitors.length === 0 && aspirational.length === 0) {
      setError('Add at least one competitor or aspirational handle.')
      return
    }

    start()
    try {
      // 1. Competitor landscape: scrape the seeds + discover similar accounts.
      setStep('Scraping competitors & discovering similar accounts…')
      const accounts: AnalyzedAccount[] = []
      const seen = new Set<string>()
      const push = (p: NormalizedProfile, source: AnalyzedAccount['source']) => {
        const k = p.username.toLowerCase()
        if (seen.has(k)) return
        seen.add(k)
        accounts.push(toAccount(p, source))
      }

      if (competitors.length > 0) {
        const { inputProfiles, candidateProfiles } = await discoverCompetitors(
          competitors, apifyKeys, signal, 'standard', { niche: brief.primaryNiche, geminiKeys },
        )
        if (signal.aborted) return
        inputProfiles.forEach((p) => push(p, 'competitor'))
        candidateProfiles.slice(0, 12).forEach((p) => push(p, 'discovered'))
      }

      // 2. Aspirational accounts: scrape for metrics.
      if (aspirational.length > 0) {
        setStep('Analysing aspirational accounts…')
        const asp = await scrapeHandles(aspirational, apifyKeys, signal).catch(() => [])
        if (signal.aborted) return
        asp.forEach((p) => push(p, 'aspirational'))
      }

      // 3. HookMap: deep-analyse the top competitors + all aspirational accounts.
      let hookSummaries: CreatorHookSummary[] = []
      if (await singleReelFnAvailable(signal)) {
        const topCompetitors = accounts
          .filter((a) => a.source !== 'aspirational')
          .sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0))
          .slice(0, HOOKMAP_COMPETITORS)
          .map((a) => a.username)
        const targets = [...new Set([...aspirational, ...topCompetitors])]
        setStep(`Deep-analysing reels for ${targets.length} accounts (this takes a few minutes)…`)
        const summaries = await Promise.all(
          targets.map((h) => creatorLimit(() => analyzeCreatorHooks(h, apifyKeys, geminiKeys, signal))),
        )
        if (signal.aborted) return
        hookSummaries = summaries.filter((s): s is CreatorHookSummary => s != null)
      } else {
        devWarn('[strategy] single-reel fn unavailable — generating from metrics only')
      }

      // 4. Synthesize the strategy document.
      setStep('Writing the content strategy…')
      const doc = await analyzeContentStrategy(geminiKeys, brief, accounts, hookSummaries, signal)
      if (signal.aborted) return

      setResult({ brief, doc, accounts, hookSummaries, generatedAt: Date.now() })
    } catch (err) {
      if (signal.aborted) return
      devWarn('[strategy] generation failed:', err)
      setError('Couldn’t generate the strategy — check the handles and try again.')
    }
  }

  return { generate, cancel }
}
