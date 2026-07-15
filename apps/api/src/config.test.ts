import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const AUTH = {
  DISCORD_CLIENT_ID: "id",
  DISCORD_CLIENT_SECRET: "secret",
  SESSION_SECRET: "a-long-enough-session-secret",
};

describe("loadConfig", () => {
  it("applies defaults for a bare environment", () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      PORT: 4000,
      NODE_ENV: "development",
      authEnabled: false,
    });
  });

  it("coerces PORT from its string environment value", () => {
    expect(loadConfig({ PORT: "8080" }).PORT).toBe(8080);
  });

  it("rejects a nonsense PORT rather than silently defaulting", () => {
    expect(() => loadConfig({ PORT: "not-a-port" })).toThrow(/PORT/);
  });

  it("rejects a BASE_URL that isn't a URL", () => {
    expect(() => loadConfig({ BASE_URL: "nope" })).toThrow(/BASE_URL/);
  });

  it("rejects a too-short session secret", () => {
    expect(() => loadConfig({ SESSION_SECRET: "short" })).toThrow(
      /SESSION_SECRET/,
    );
  });

  it("reports authEnabled only when Discord is fully configured", () => {
    expect(loadConfig(AUTH).authEnabled).toBe(true);
    // Partial configuration is not "enabled".
    expect(
      loadConfig({
        DISCORD_CLIENT_ID: "id",
        SESSION_SECRET: AUTH.SESSION_SECRET,
      }).authEnabled,
    ).toBe(false);
  });

  it("refuses to boot in production without auth configured", () => {
    // An API that silently treats everyone as anonymous is worse than one that
    // won't start.
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/Production/);
  });

  it("boots in production once auth is configured", () => {
    expect(() => loadConfig({ NODE_ENV: "production", ...AUTH })).not.toThrow();
  });
});
