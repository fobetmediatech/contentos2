/**
 * PerformanceManagementPage — the module shell: heading, grouped section nav, active section.
 *
 * The module is two different products depending on who is looking. HR and admins get the whole
 * thing — teams, assignment, everyone's records. An ordinary member gets three sections about
 * themselves: their inbox, their tasks, their performance. The HR sections are not disabled or
 * padlocked for them, they are absent, and their routes redirect.
 *
 * That filtering is presentation only. RLS scopes task rows to the caller and restricts the team
 * tables to HR/admin (migration 20260826000002) — hiding a link has never been a permission.
 *
 * Section navigation uses router links rather than local state, so every section is deep-linkable
 * and survives a refresh. The nav is driven entirely by PERFORMANCE_SECTIONS; adding a section is
 * one entry there plus one route in App.tsx.
 */
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ClipboardCheck } from 'lucide-react'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { useIsHr } from '../../hooks/useIsHr'
import {
  visibleSections, visibleGroups, findSection, sectionLabel, sectionDescription,
} from './performanceSections'

function SectionNav({ canManage }: { canManage: boolean }) {
  const sections = visibleSections(canManage)
  return (
    <nav aria-label="Performance sections" className="flex flex-col gap-4 sm:gap-5">
      {visibleGroups(canManage).map((group) => (
        <div key={group}>
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted mb-2">{group}</h2>
          <ul className="flex flex-wrap gap-1.5 sm:flex-col sm:gap-0.5">
            {sections.filter((s) => s.group === group).map((section) => (
              <li key={section.path}>
                <NavLink
                  to={section.path}
                  className={({ isActive }) =>
                    [
                      'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
                      isActive
                        ? 'bg-[var(--color-surface-raised)] text-primary font-medium'
                        : 'text-secondary hover:bg-[var(--color-surface-raised)] hover:text-primary',
                    ].join(' ')
                  }
                >
                  {({ isActive }) => (
                    <>
                      <section.icon
                        size={15}
                        aria-hidden="true"
                        className={isActive ? 'text-[var(--color-accent)]' : ''}
                      />
                      <span>{sectionLabel(section, canManage)}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export default function PerformanceManagementPage() {
  const { pathname } = useLocation()
  const { isAdmin } = useIsAdmin()
  const { isHr } = useIsHr()
  const canManage = isAdmin || isHr

  // Section path is everything after /performance/ — e.g. "tasks/records".
  const current = findSection(pathname.replace(/^\/performance\/?/, ''))

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="font-serif italic text-3xl text-primary flex items-center gap-2">
          <ClipboardCheck size={24} className="text-[var(--color-accent)]" aria-hidden="true" />
          Performance Management
        </h1>
        <p className="text-secondary text-sm mt-1">
          {canManage
            ? 'Assign tasks with deadlines and see how they landed — completed, early, or delayed.'
            : 'Your tasks and deadlines, and how your completed work landed against them.'}
        </p>
      </header>

      <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
        <aside className="sm:w-56 sm:shrink-0">
          <SectionNav canManage={canManage} />
        </aside>

        <section className="min-w-0 flex-1" aria-label={current ? sectionLabel(current, canManage) : 'Performance section'}>
          {current && (
            <div className="mb-4">
              <h2 className="text-primary text-lg font-medium">{sectionLabel(current, canManage)}</h2>
              <p className="text-secondary text-sm mt-0.5">{sectionDescription(current, canManage)}</p>
            </div>
          )}
          <Outlet />
        </section>
      </div>
    </div>
  )
}
