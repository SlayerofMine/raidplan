// Vitest global setup for component tests: register jest-dom matchers (typed
// for vitest) and unmount React trees between tests to keep them isolated.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
