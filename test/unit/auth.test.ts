import { describe, expect, it } from "vitest";
import {
  hashPassword,
  verifyPassword,
  requireRole,
} from "../../src/auth/session.js";

describe("authentication primitives", () => {
  it("stores a salted scrypt hash and verifies only the matching password", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(encoded).toMatch(/^scrypt\$/);
    expect(encoded).not.toContain("correct horse battery staple");
    await expect(
      verifyPassword("correct horse battery staple", encoded),
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong password", encoded)).resolves.toBe(
      false,
    );
  });

  it("enforces the caller role against an explicit allow list", () => {
    expect(() =>
      requireRole({ id: "u1", email: "a@b.test", role: "client" }, "client"),
    ).not.toThrow();
    expect(() =>
      requireRole(
        { id: "u1", email: "a@b.test", role: "contributor" },
        "client",
      ),
    ).toThrow("not allowed");
  });
});
