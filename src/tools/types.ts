/**
 * Shared type contracts for the pipeline tool registry.
 *
 * PipelineToolDescriptor — pure data, no logic, no hook calls.
 * Adding a third pipeline (e.g. 'brand-audit') requires:
 *   1. A new entry in registry.ts implementing this interface.
 *   2. One dispatch case in useConversation.ts → confirmSeeds().
 *
 * ResolvedIntent — the non-clarification branch of ParsedIntent.
 * Avoids re-typing the Extract<> predicate everywhere.
 */

import type { ParsedIntent } from '../ai/intentParser'

/**
 * The resolved (non-clarification) branch of ParsedIntent.
 * Safe to access .niche, .location, .pipelineType, etc. without narrowing.
 */
export type ResolvedIntent = Extract<ParsedIntent, { needsClarification?: false | null | undefined }>

/**
 * Registry entry for a single pipeline tool.
 *
 * @property id            - Matches ParsedIntent.pipelineType (e.g. 'competitor', 'discovery').
 * @property name          - Human-readable label shown in UI and logs.
 * @property steps         - Ordered step labels shown in <ProgressSteps />. Length drives the step bar.
 * @property confirmMessage - Returns the assistant message shown before the user confirms.
 * @property confirmOptions - Returns the option buttons shown with the confirm message.
 * @property resultsPath   - Absolute router path to navigate to on completion (e.g. '/results').
 */
export interface PipelineToolDescriptor {
  id: string
  name: string
  steps: string[]
  confirmMessage: (intent: ResolvedIntent) => string
  confirmOptions: (intent: ResolvedIntent) => string[]
  resultsPath: string
}
