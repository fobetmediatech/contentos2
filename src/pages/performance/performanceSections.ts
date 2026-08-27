/**
 * PERFORMANCE_SECTIONS — the single source of truth for the Performance module's internal
 * navigation. Paths, labels, group labels, icons and descriptions live here once so the nav,
 * the routes and the section headers can never drift apart.
 *
 * Scope: HR approval sections (pending / approved / rejected) are intentionally absent. The
 * approval workflow was dropped in favour of shipping task assignment first, so there is no
 * approval UI standing empty pretending a workflow exists.
 */
import { ClipboardList, Inbox, ListChecks, UsersRound, Users2, type LucideIcon } from 'lucide-react'

export interface PerformanceSection {
  /** Path relative to /performance — also the route path. */
  path: string
  label: string
  /** Heading the sections are grouped under in the nav. */
  group: string
  icon: LucideIcon
  /** One honest line under the section heading. */
  description: string
  /**
   * Hidden entirely from members who cannot manage — not disabled, not padlocked. The route
   * redirects too, so the feature simply does not exist for them.
   */
  hrOnly?: boolean
  /**
   * What a plain member calls this section. RLS already narrows their rows to their own, so
   * "All task records" would name a section that, for them, holds exactly one person's work.
   * The data was always right; only the labelling oversold it.
   */
  memberLabel?: string
  memberDescription?: string
}

export const PERFORMANCE_SECTIONS: PerformanceSection[] = [
  {
    path: 'inbox',
    label: 'Inbox',
    group: 'You',
    icon: Inbox,
    description: 'Notifications for tasks assigned to you, tasks reopened, and teams you were added to.',
  },
  {
    path: 'tasks/records',
    label: 'All task records',
    group: 'Work',
    icon: ListChecks,
    description: 'Every assigned task with its deadline, completion time, and how it landed against the due date.',
    memberLabel: 'My tasks',
    memberDescription: 'Tasks assigned to you, with the deadline, when you completed them, and how that landed.',
  },
  {
    path: 'tasks/assign',
    label: 'Task assignment',
    group: 'Work',
    icon: ClipboardList,
    description: 'Assign a task to a team member with a deadline.',
    hrOnly: true,
  },
  {
    path: 'teams',
    label: 'Teams',
    group: 'Work',
    icon: Users2,
    description: 'Create teams and add members from the people who have signed in.',
    hrOnly: true,
  },
  {
    path: 'results/employees',
    label: 'Employee performance',
    group: 'Results',
    icon: UsersRound,
    description: 'Per-person totals derived from task records — completed, early, on time, delayed.',
    memberLabel: 'My performance',
    memberDescription: 'Your own totals — completed, early, on time, delayed.',
  },
]

/**
 * The section a bare /performance (or an unknown child path) resolves to.
 *
 * The inbox, because it is the only section every user has a personal reason to open — and it is
 * where a notification is telling them to look.
 */
export const DEFAULT_PERFORMANCE_SECTION = 'inbox'

/** Group labels in nav order, derived so a new section never needs the list updated by hand. */
export function performanceGroups(): string[] {
  return [...new Set(PERFORMANCE_SECTIONS.map((s) => s.group))]
}

export function findSection(path: string): PerformanceSection | undefined {
  return PERFORMANCE_SECTIONS.find((s) => s.path === path)
}

/**
 * The sections a given viewer may see. `canManage` is HR or admin.
 *
 * This is presentation only. The real boundary is in the database: RLS scopes task rows to the
 * caller and restricts the team tables to HR/admin (migration 20260826000002). Filtering here
 * stops a member being shown a door they cannot open; it is not what keeps it shut.
 */
export function visibleSections(canManage: boolean): PerformanceSection[] {
  return canManage ? PERFORMANCE_SECTIONS : PERFORMANCE_SECTIONS.filter((s) => !s.hrOnly)
}

/** Group labels for the sections this viewer can actually see — no empty headings. */
export function visibleGroups(canManage: boolean): string[] {
  return [...new Set(visibleSections(canManage).map((s) => s.group))]
}

export function sectionLabel(section: PerformanceSection, canManage: boolean): string {
  return canManage ? section.label : section.memberLabel ?? section.label
}

export function sectionDescription(section: PerformanceSection, canManage: boolean): string {
  return canManage ? section.description : section.memberDescription ?? section.description
}
