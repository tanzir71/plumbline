import { describe, expect, it } from "vitest";
import { TEST_DID_NOT_FINISH, proofRunProblem } from "../src/index.js";

describe("proofRunProblem", () => {
  it.each([
    ["Vitest config", "failed to load config\nStartup Error\nError: EPERM: operation not permitted, open 'x.mjs'"],
    ["Vitest import", "Error: Failed to resolve import \"@/missing\"\nTest Files  1 failed (1)\nTests  no tests"],
    ["PostCSS", "Error: Loading PostCSS Plugin failed: Cannot find module '@tailwindcss/postcss'\nTests  no tests"],
    ["Jest suite", "Test suite failed to run\nCannot find module './x'\nTests:       0 total"],
    ["pytest collection", "ERROR collecting test_x.py\nModuleNotFoundError: No module named 'x'\n1 error in 0.10s"],
    ["node import", "not ok 1 - x.test.js\ncode: 'ERR_MODULE_NOT_FOUND'\n# fail 1"],
    ["missing command", "'vitest' is not recognized as an internal or external command"],
    ["syntax error", "SyntaxError: Unexpected token ')'"],
    ["timeout", `partial output\nAssertionError: late\n${TEST_DID_NOT_FINISH}: spawnSync ETIMEDOUT`],
  ])("rejects a %s failure", (_name, output) => {
    expect(proofRunProblem(output)).toEqual(expect.any(String));
  });

  it.each([
    ["Vitest", "AssertionError: expected 1 to be 2\nTests  1 failed (1)"],
    ["Jest", "expect(received).toBe(expected)\nExpected: 2\nReceived: 1\nTests:       1 failed, 1 total"],
    ["pytest", "E       assert 1 == 2\n1 failed in 0.10s"],
    ["node", "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal\n# fail 1"],
    ["Go", "--- FAIL: TestLimit (0.00s)\nFAIL"],
    ["a test that asserts on an error message", "Error: Cannot find module 'x'\nAssertionError: expected error to be handled"],
    ["a framework with unknown output", "Test failed: tenant filter missing"],
  ])("accepts a real %s failure", (_name, output) => {
    expect(proofRunProblem(output)).toBeNull();
  });

  it("reads coloured terminal output", () => {
    const esc = String.fromCharCode(27);
    expect(proofRunProblem(`${esc}[31mError: ${esc}[1mEPERM${esc}[22m denied${esc}[39m`)).toContain("EPERM");
  });
});
