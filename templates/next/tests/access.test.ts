// Rule 5, the decision itself (src/lib/access.ts): one test for each role, for an account with no
// recognised role, and for nobody. Run with `npm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLES, type Role } from "../src/app-config";
import { decide, whoFrom } from "../src/lib/access";

const session = (role: unknown) => ({ user: { id: "u1", name: "Sample Person", email: "person@example.test", role } });

describe("who is asking", () => {
  it("nobody, when there is no session", () => {
    assert.deepEqual(whoFrom(null), { kind: "nobody" });
    assert.deepEqual(whoFrom(undefined), { kind: "nobody" });
    assert.deepEqual(whoFrom({ user: { id: "", name: "x", email: "x@example.test", role: "manager" } }), { kind: "nobody" });
  });
  for (const role of ROLES) {
    it(`a user with the role ${role}`, () => {
      assert.deepEqual(whoFrom(session(role)), { kind: "user", user: { userId: "u1", name: "Sample Person", email: "person@example.test", role } });
    });
  }
  it("an account with no role this app recognises is not given the lowest role", () => {
    for (const odd of ["none", "", "Employee", "EMPLOYEE", " employee", "admin", "root", null, undefined, 0, 1, true, {}, ["employee"], "employee,hr_admin", "__proto__", "constructor"]) {
      const who = whoFrom(session(odd));
      assert.equal(who.kind, "no-role", `role ${JSON.stringify(odd)}`);
    }
  });
});

describe("may they: a page, action or route for HR admins only", () => {
  const allowed: Role[] = ["hr_admin"];
  it("employee: refused, role not allowed", () => {
    assert.deepEqual(decide(whoFrom(session("employee")), allowed), { allow: false, reason: "role_not_allowed", role: "employee" });
  });
  it("manager: refused, role not allowed", () => {
    assert.deepEqual(decide(whoFrom(session("manager")), allowed), { allow: false, reason: "role_not_allowed", role: "manager" });
  });
  it("HR admin: allowed, and the user is handed on", () => {
    const d = decide(whoFrom(session("hr_admin")), allowed);
    assert.equal(d.allow, true);
    assert.equal(d.allow && d.user.role, "hr_admin");
  });
  it("no recognised role: refused, even where every role is allowed", () => {
    assert.deepEqual(decide(whoFrom(session("none")), allowed), { allow: false, reason: "role_not_recognised", role: null });
    assert.deepEqual(decide(whoFrom(session("none")), ROLES), { allow: false, reason: "role_not_recognised", role: null });
  });
  it("nobody: refused, not signed in", () => {
    assert.deepEqual(decide(whoFrom(null), allowed), { allow: false, reason: "not_signed_in", role: null });
    assert.deepEqual(decide(whoFrom(null), ROLES), { allow: false, reason: "not_signed_in", role: null });
  });
});

describe("may they: the list of roles itself", () => {
  it("an empty list allows nobody", () => {
    for (const role of ROLES) assert.equal(decide(whoFrom(session(role)), []).allow, false);
  });
  it("every recognised role is allowed where the list is every role", () => {
    for (const role of ROLES) assert.equal(decide(whoFrom(session(role)), ROLES).allow, true);
  });
  it("a name on the list that is not a role lets nobody in under it", () => {
    const list = ["none", "admin"] as unknown as Role[];
    assert.equal(decide(whoFrom(session("none")), list).allow, false);
    assert.equal(decide(whoFrom(session("admin")), list).allow, false);
    assert.equal(decide(whoFrom(session("employee")), list).allow, false);
  });
});
