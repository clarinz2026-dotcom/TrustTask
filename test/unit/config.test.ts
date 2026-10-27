import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("configuration", () => {
  it("uses safe local listener defaults when the database URL is supplied", () => {
    expect(
      loadConfig({ DATABASE_URL: "postgres://localhost/trusttask" }),
    ).toMatchObject({
      NODE_ENV: "development",
      HOST: "0.0.0.0",
      PORT: 3000,
    });
  });

  it("rejects missing database configuration", () => {
    expect(() => loadConfig({})).toThrow();
  });

  it("rejects invalid ports", () => {
    expect(() =>
      loadConfig({ DATABASE_URL: "postgres://localhost/db", PORT: "70000" }),
    ).toThrow();
  });

  it("refuses the local signing key in production mode", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgres://localhost/db",
        NODE_ENV: "production",
      }),
    ).toThrow("SESSION_SECRET must be set in production");
  });
});
