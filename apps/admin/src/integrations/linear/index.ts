/**
 * Linear admin-UI public surface.
 *
 * Exports are intentionally named to map cleanly onto a future
 * `PlatformConfigurator` interface — see `project_admin_ui_platform_
 * configurator` in auto-memory and the `TODO(platform-configurator)`
 * anchors in shared admin files. The future refactor wraps these
 * exports into a configurator object with no logic changes.
 */

export type { LinearConfig, LinearTemplateConfig } from './types';
export { defaultLinearConfig } from './defaults';
export { isLinearConfig, validateLinearConfig } from './validators';
export { LinearWizard } from './components/linear-wizard';
export { LinearTeamPicker } from './components/linear-team-picker';
export { LinearProjectFields } from './components/linear-project-fields';
