import { describe, expect, it } from "vitest";

import { BASE_STYLES, THEME_DEFAULTS, themeVar } from "../src/base.js";

describe("theme tokens", () => {
  it("resolves --bitgate-* first, then deprecated --gov-*, then the default", () => {
    for (const name of Object.keys(THEME_DEFAULTS)) {
      expect(themeVar(/** @type {keyof typeof THEME_DEFAULTS} */ (name))).toBe(
        `var(--bitgate-${name}, var(--gov-${name}, ${THEME_DEFAULTS[name]}))`,
      );
    }
  });

  it("keeps --gov-* host defaults so existing overrides still apply", () => {
    for (const [name, value] of Object.entries(THEME_DEFAULTS)) {
      expect(BASE_STYLES).toContain(`--gov-${name}: ${value}`);
    }
  });

  it("does not assign --bitgate-* on :host (that would shadow --gov-* overrides)", () => {
    expect(BASE_STYLES).not.toMatch(/--bitgate-[a-z]+:/);
  });

  it("uses the fallback chain at every painted token", () => {
    expect(BASE_STYLES).toContain(themeVar("fg"));
    expect(BASE_STYLES).toContain(themeVar("muted"));
    expect(BASE_STYLES).toContain(themeVar("border"));
    expect(BASE_STYLES).toContain(themeVar("surface"));
    expect(BASE_STYLES).toContain(themeVar("radius"));
  });
});
