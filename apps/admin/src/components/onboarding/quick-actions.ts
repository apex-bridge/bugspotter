import type { LucideIcon } from 'lucide-react';
import type { OnboardingState } from '../../hooks/use-onboarding-status';

/**
 * Identifier for a registered quick-action. Add new ids here when
 * registering a new action so the rest of the type system can guard
 * against typos in handler maps.
 */
export type QuickActionId = 'sdk-snippet' | 'connect-jira';

/**
 * Declarative description of one CTA in the admin top-bar. Each
 * action carries its OWN visibility predicate against `OnboardingState`,
 * so adding a new CTA is a pure data change — no edits to the parent
 * component, no shared if/else ladder. The runtime click handler is
 * wired up by the consuming component (it needs access to `useNavigate`
 * / dialog state, which can't live in a static module).
 */
export interface QuickAction {
  /** Stable id, used to look up the click handler in the consuming component. */
  id: QuickActionId;
  /** i18n key for the button label. */
  labelKey: string;
  /** Lucide icon component. */
  icon: LucideIcon;
  /** Visual prominence — only one `primary` action should typically be visible at a time. */
  variant: 'primary' | 'secondary';
  /**
   * Predicate deciding whether this action should render. Pure function
   * over `OnboardingState` so it's trivially testable in isolation.
   * Add new state fields to `OnboardingState` as new conditions are
   * needed (e.g. `isSaaS`, `hasCustomDomain`, `hasCardOnFile`).
   */
  visible: (state: OnboardingState) => boolean;
}
