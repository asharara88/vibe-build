import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadAppSpec } from "../src/spec/app-spec.js";

const example1 = JSON.parse(readFileSync(new URL("../src/spec/examples/example-1-leave-request.json", import.meta.url), "utf8"));

describe("app spec", () => {
  it("accepts the fixed brief for test example 1 (leave request)", () => {
    const spec = loadAppSpec(example1);
    expect(spec.name).toBe("leave_request");
    expect(spec.roles.map((r) => r.name)).toEqual(["employee", "manager", "hr_admin"]);
    expect(spec.acceptance).toHaveLength(6);
    expect(spec.actions.length).toBeGreaterThanOrEqual(3);
    expect(spec.actions.length).toBeLessThanOrEqual(5);
  });

  it("names the problem in plain words when a screen is for an unknown role", () => {
    const broken = structuredClone(example1);
    broken.screens[0].for_role = "finance";
    expect(() => loadAppSpec(broken)).toThrow(/Screen "my_requests" is for unknown role "finance"/);
  });

  it("refuses a choice field with no choices", () => {
    const broken = structuredClone(example1);
    const status = broken.entities[1].fields.find((f: { name: string }) => f.name === "status");
    status.choices = [];
    expect(() => loadAppSpec(broken)).toThrow(/is a choice with no choices/);
  });

  it("refuses more than five core actions", () => {
    const broken = structuredClone(example1);
    while (broken.actions.length < 6) broken.actions.push({ ...broken.actions[0], name: `extra_${broken.actions.length}` });
    expect(() => loadAppSpec(broken)).toThrow(/actions/);
  });
});
