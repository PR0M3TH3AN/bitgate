// Shared test utilities for conformance harness
export function createFixture(name, state, target, expectation) {
  return {
    name,
    state: {
      adminState: state.adminState || {},
      trust: state.trust || {},
      reports: state.reports || [],
      trustedMutes: state.trustedMutes || [],
      overrides: state.overrides || {},
    },
    target,
    expectation,
  };
}

export function runConformanceTest(fixture, evaluator) {
  const decision = evaluator(fixture.state, fixture.target);
  return {
    passed: JSON.stringify(decision) === JSON.stringify(fixture.expectation),
    actual: decision,
    expected: fixture.expectation,
  };
}