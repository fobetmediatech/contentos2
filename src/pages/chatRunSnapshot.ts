import type { RunRecord } from '../domain/runs'
import type { ChatMessage } from '../domain/chat'

const summary: Record<RunRecord['kind'], string> = {
  transcript: 'Transcript ready.',
  'single-reel': 'Reel case study ready.',
  reel: 'Reel breakdown ready.',
  discovery: 'Discovery complete.',
  competitor: 'Analysis complete.',
  repurpose: 'Repurpose ready.',
}

export function runToMessage(run: RunRecord): Omit<ChatMessage, 'id' | 'timestamp'> {
  if (run.status === 'failed') {
    return { role: 'assistant', content: run.error ?? 'Something went wrong.', type: 'error' }
  }
  return { role: 'assistant', content: summary[run.kind], type: 'result', result: run.result }
}
