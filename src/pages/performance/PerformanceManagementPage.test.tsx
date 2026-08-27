// @vitest-environment jsdom
/**
 * Performance module shell tests — section configuration, deep-link routing, unknown-child
 * recovery, the accessible active-section marker, and the role split.
 *
 * The role split is the part worth guarding: an ordinary member must not be shown Teams or Task
 * assignment at all, and must see their sections named for what they actually hold. These are
 * presentation tests — the real boundary is RLS (migration 20260826000002), which no React test
 * can stand in for.
 *
 * The sections themselves are not rendered here: they hit Supabase and Clerk, which belongs in
 * their own tests. This file covers the shell's contract.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'

// Role hooks are react-query based; stub them so the shell can be rendered at either role
// without a QueryClientProvider or a network round-trip.
const role = { isAdmin: false, isHr: false }
vi.mock('../../hooks/useIsAdmin', () => ({
  useIsAdmin: () => ({ isAdmin: role.isAdmin, isLoading: false }),
}))
vi.mock('../../hooks/useIsHr', () => ({
  useIsHr: () => ({ isHr: role.isHr, isLoading: false }),
}))

import PerformanceManagementPage from './PerformanceManagementPage'
import {
  PERFORMANCE_SECTIONS, DEFAULT_PERFORMANCE_SECTION, performanceGroups, findSection,
  visibleSections, visibleGroups, sectionLabel, sectionDescription,
} from './performanceSections'

afterEach(() => {
  cleanup()
  role.isAdmin = false
  role.isHr = false
})

/** Mirrors the nesting in App.tsx, with stub leaves so no section touches the network. */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/performance" element={<PerformanceManagementPage />}>
          <Route index element={<Navigate to="inbox" replace />} />
          {PERFORMANCE_SECTIONS.map((s) => (
            <Route key={s.path} path={s.path} element={<div data-testid="section">{s.label} content</div>} />
          ))}
          <Route path="*" element={<Navigate to="/performance/inbox" replace />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('performanceSections config', () => {
  it('has unique paths', () => {
    const paths = PERFORMANCE_SECTIONS.map((s) => s.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('points its default at a section that actually exists', () => {
    expect(findSection(DEFAULT_PERFORMANCE_SECTION)).toBeDefined()
  })

  it('defaults to the inbox — where a notification sends you', () => {
    expect(DEFAULT_PERFORMANCE_SECTION).toBe('inbox')
  })

  it('derives group order from the sections rather than a hand-kept list', () => {
    expect(performanceGroups()).toEqual(['You', 'Work', 'Results'])
  })

  it('gives every section a label and an honest description', () => {
    for (const s of PERFORMANCE_SECTIONS) {
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.description.length).toBeGreaterThan(0)
    }
  })

  it('carries no HR approval sections — that workflow was dropped, not hidden', () => {
    const labels = PERFORMANCE_SECTIONS.map((s) => s.label.toLowerCase()).join(' ')
    expect(labels).not.toContain('approval')
    expect(labels).not.toContain('rejected')
  })

  it('flags exactly the sections that need HR', () => {
    expect(PERFORMANCE_SECTIONS.filter((s) => s.hrOnly).map((s) => s.path))
      .toEqual(['tasks/assign', 'teams'])
  })
})

describe('visibleSections', () => {
  it('withholds every HR section from a plain member', () => {
    expect(visibleSections(false).map((s) => s.path)).toEqual(['inbox', 'tasks/records', 'results/employees'])
  })

  it('gives a manager the full set', () => {
    expect(visibleSections(true)).toHaveLength(PERFORMANCE_SECTIONS.length)
  })

  it('drops a group heading once nothing under it is visible', () => {
    // 'Work' survives because task records stay; the point is groups derive from what is shown.
    expect(visibleGroups(false)).toEqual(['You', 'Work', 'Results'])
    expect(visibleGroups(true)).toEqual(['You', 'Work', 'Results'])
  })

  it('names a member’s sections for what they actually hold', () => {
    const records = findSection('tasks/records')!
    const results = findSection('results/employees')!
    expect(sectionLabel(records, false)).toBe('My tasks')
    expect(sectionLabel(results, false)).toBe('My performance')
    expect(sectionLabel(records, true)).toBe('All task records')
    expect(sectionLabel(results, true)).toBe('Employee performance')
  })

  it('falls back to the shared description when a section has no member-specific one', () => {
    const inbox = findSection('inbox')!
    expect(sectionDescription(inbox, false)).toBe(inbox.description)
    expect(sectionLabel(inbox, false)).toBe(inbox.label)
  })
})

describe('PerformanceManagementPage — plain member', () => {
  it('shows only their three sections, with no link to Teams or Task assignment', () => {
    renderAt('/performance/tasks/records')
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(3)
    expect(screen.queryByRole('link', { name: /teams/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /task assignment/i })).toBeNull()
  })

  it('labels their sections as their own', () => {
    renderAt('/performance/tasks/records')
    expect(screen.getByRole('link', { name: /my tasks/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /my performance/i })).toBeTruthy()
    expect(screen.queryByText('All task records')).toBeNull()
  })
})

describe('PerformanceManagementPage — HR', () => {
  it('shows the full section set', () => {
    role.isHr = true
    renderAt('/performance/tasks/records')
    expect(screen.getAllByRole('link')).toHaveLength(PERFORMANCE_SECTIONS.length)
    expect(screen.getByRole('link', { name: /teams/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /task assignment/i })).toBeTruthy()
  })

  it('gives an admin the same full set as HR', () => {
    role.isAdmin = true
    renderAt('/performance/tasks/records')
    expect(screen.getAllByRole('link')).toHaveLength(PERFORMANCE_SECTIONS.length)
  })
})

describe('PerformanceManagementPage routing', () => {
  it('renders the module heading once', () => {
    renderAt('/performance/tasks/records')
    expect(screen.getByRole('heading', { level: 1, name: /performance management/i })).toBeTruthy()
  })

  it.each(PERFORMANCE_SECTIONS.map((s) => [s.path, s.label] as const))(
    'deep-links to %s',
    (path, label) => {
      role.isHr = true
      renderAt(`/performance/${path}`)
      expect(screen.getByTestId('section').textContent).toBe(`${label} content`)
    },
  )

  it('resolves bare /performance to the default section', () => {
    renderAt('/performance')
    const expected = findSection(DEFAULT_PERFORMANCE_SECTION)!
    expect(screen.getByTestId('section').textContent).toBe(`${expected.label} content`)
  })

  it('recovers an unknown child route to the default section instead of dead-ending', () => {
    renderAt('/performance/tasks/nonsense')
    const expected = findSection(DEFAULT_PERFORMANCE_SECTION)!
    expect(screen.getByTestId('section').textContent).toBe(`${expected.label} content`)
  })

  it('marks the active section programmatically, not just visually', () => {
    renderAt('/performance/results/employees')
    const active = screen.getByRole('link', { current: 'page' })
    expect(active.textContent).toContain('My performance')
  })

  it('labels the section nav for assistive tech', () => {
    renderAt('/performance/tasks/records')
    expect(screen.getByRole('navigation', { name: /performance sections/i })).toBeTruthy()
  })
})
