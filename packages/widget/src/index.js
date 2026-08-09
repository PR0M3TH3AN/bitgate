// @bitgate/widget
//
// Custom elements built strictly on the published API. They render decisions
// and issue commands; they compute no policy. If an element here ever needs a
// threshold, that is a signal the policy definition is missing a profile —
// not that the widget needs a number.
//
// Elements receive a runtime rather than creating one, so a host application
// can share a single governance runtime across an entire page.

export {
  BASE_STYLES,
  GovernanceElement,
  canRegisterElements,
  defineElement,
  escapeHtml,
  requestContext,
  shortenKey,
  targetFromAttributes,
} from "./base.js";

export {
  BitGateError,
  BitGateProvider,
  CONTEXT_REQUEST,
  defineProviderElements,
} from "./provider.js";

export {
  DEFAULT_REASON_TEXT,
  GovernanceReport,
  GovernanceStatus,
  GovernanceVeil,
  defineViewerElements,
  describeReasons,
} from "./viewer.js";

export {
  CAPABILITY_LABELS,
  GovernanceAction,
  GovernanceAdminPanel,
  GovernanceCapabilities,
  defineAdminElements,
} from "./admin.js";

import { defineAdminElements } from "./admin.js";
import { defineProviderElements } from "./provider.js";
import { defineViewerElements } from "./viewer.js";

/**
 * Register every governance element.
 *
 * Safe to call more than once and safe to import in Node: registration is a
 * no-op without a DOM, so a server-rendering host can import the helpers
 * without guarding.
 *
 * @returns {string[]} Element names newly registered by this call
 */
export function defineBitGateElements() {
  return [...defineProviderElements(), ...defineViewerElements(), ...defineAdminElements()];
}
