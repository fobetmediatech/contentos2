/**
 * CHAT_TOOL_COMMANDS — single source of truth for the chat's discoverable tools.
 *
 * Both surfaces render off this one list:
 *   - the empty-state chip bar (ChatPage welcome block)
 *   - the "/" slash-command menu (SlashCommandMenu)
 *
 * Picking a command ARMS a tool: it does NOT dump a fake example into the input.
 * The input clears and shows `placeholder` guidance; the user types only their
 * own values (handles, reel URL, city). At send time `buildPrompt` wraps that
 * raw input into a routing phrase so the right pipeline fires — the template is
 * never shown in the box.
 *
 * This is DISPLAY + routing-hint metadata only. The Gemini-facing tool
 * declarations still live in `src/tools/agentTools.ts`; `buildPrompt` just
 * produces natural language those declarations already route on. `id` matches
 * the agentTools dispatch name so the two stay traceable.
 */

export interface ChatToolCommand {
  /** Matches the dispatch name in agentTools.ts (e.g. 'analyze_single_reel'). */
  id: string
  /** Short display name shown as the chip title / menu row heading. */
  label: string
  /** One-line description of what the tool does. */
  hint: string
  /** Ghost text shown in the input after the tool is armed — guides what to type. */
  placeholder: string
  /**
   * Wraps the user's raw input into the prompt actually sent to the agent.
   * Never called with empty input (send is gated on non-empty input).
   */
  buildPrompt: (userInput: string) => string
}

export const CHAT_TOOL_COMMANDS: ChatToolCommand[] = [
  {
    id: 'discover_competitors',
    label: 'Find competitors',
    hint: 'See who is winning in a niche',
    placeholder: 'a niche, or reference @handles to match',
    buildPrompt: (input) => `Find the top competitors for ${input}`,
  },
  {
    id: 'discover_by_location',
    label: 'Discover by city',
    hint: 'Find creators based in a location',
    placeholder: 'a city and niche, e.g. Mumbai food',
    buildPrompt: (input) => `Discover creators based in ${input}`,
  },
  {
    id: 'analyze_reels',
    label: 'Break down hooks',
    hint: 'Reverse-engineer viral hook patterns',
    placeholder: 'one or more creator @handles',
    buildPrompt: (input) => `Break down the reel hooks of ${input}`,
  },
  {
    id: 'analyze_single_reel',
    label: 'Analyze one reel',
    hint: 'Full breakdown + transcript of a reel link',
    placeholder: 'paste a reel URL',
    buildPrompt: (input) => `Analyze this reel in depth: ${input}`,
  },
  {
    id: 'repurpose_reel',
    label: 'Repurpose a reel',
    hint: "Rewrite a viral reel in a client's voice",
    placeholder: 'a reel URL and the client @handle',
    buildPrompt: (input) => `Repurpose this reel for a client: ${input}`,
  },
  {
    id: 'get_reel_transcript',
    label: 'Transcribe a reel',
    hint: 'Get the full spoken transcript of a reel',
    placeholder: 'paste a reel URL',
    buildPrompt: (input) => `Transcribe this reel (transcript only, no analysis): ${input}`,
  },
]

/**
 * Filter the command list against the text typed after the "/" trigger.
 *
 * Case-insensitive substring match across `label`, `hint`, and `id`. Matching
 * `id` lets short intent words work even when the label doesn't contain them —
 * e.g. "/reel" matches `analyze_reels`, "/transcript" matches
 * `get_reel_transcript`, "/location" matches `discover_by_location`.
 *
 * An empty (or whitespace-only) query returns the full list unchanged, so
 * typing just "/" shows every tool.
 */
export function filterToolCommands(
  query: string,
  commands: ChatToolCommand[] = CHAT_TOOL_COMMANDS,
): ChatToolCommand[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return commands
  return commands.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      c.hint.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q),
  )
}
