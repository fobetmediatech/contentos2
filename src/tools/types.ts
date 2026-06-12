/**
 * Shared type contracts for the pipeline tool registry.
 *
 * PipelineToolDescriptor — pure data, no logic, no hook calls.
 */

/**
 * Registry entry for a single pipeline tool.
 *
 * @property id     - Unique key (e.g. 'competitor', 'discovery', 'reel').
 * @property name   - Human-readable label shown in UI and logs.
 * @property steps  - Ordered step labels shown in <ProgressSteps />. Length drives the step bar.
 */
export interface PipelineToolDescriptor {
  id: string
  name: string
  steps: string[]
}
