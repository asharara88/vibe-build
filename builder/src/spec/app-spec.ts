/**
 * The app spec: the machine-readable form of the brief's seven sections.
 *
 * Every other part of the builder reads or writes this: the analyst writes it,
 * the optimiser derives engine instructions from it, the acceptance runner
 * derives checks from it, and the event log links everything to it.
 * Design note: docs/design/stage-1.md, section 2.3.
 */
import { z } from "zod";

const Identifier = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "identifiers are lower_snake_case");

export const FieldType = z.enum([
  "text",
  "long_text",
  "integer",
  "decimal",
  "money",
  "date",
  "datetime",
  "boolean",
  "choice",
  "reference",
  "file",
  "email",
]);

export const Field = z.object({
  name: Identifier,
  label: z.string().min(1),
  type: FieldType,
  required: z.boolean().default(true),
  /** For `choice`: the allowed values. */
  choices: z.array(z.string().min(1)).optional(),
  /** For `reference`: the entity this field points at. */
  references: Identifier.optional(),
  /** Does this field hold personal or sensitive data? Drives rules 5 and 7 and the in-country flag. */
  sensitive: z.enum(["no", "contact_details", "salary_id_or_health"]).default("no"),
});

export const Role = z.object({
  name: Identifier,
  label: z.string().min(1),
  /** Whose records this role may see. Question bank: "Who can see other people's records?" */
  sees: z.enum(["own", "team", "all"]),
});

export const Entity = z.object({
  name: Identifier,
  label: z.string().min(1),
  fields: z.array(Field).min(1),
  /** Where the starting data comes from. Question bank, Data section. */
  starting_data: z.enum(["typed_in", "uploaded_once", "synced_on_schedule", "connected_system"]),
});

export const Screen = z.object({
  name: Identifier,
  label: z.string().min(1),
  for_role: Identifier,
  kind: z.enum(["my_items", "queue", "table_with_filters", "form", "detail", "report"]),
  entity: Identifier,
  /** Plain-language description of what the user sees. */
  shows: z.string().min(1),
});

export const Action = z.object({
  name: Identifier,
  label: z.string().min(1),
  by_role: Identifier,
  trigger: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
  result: z.string().min(1),
  /** Who is told, and how. Question bank, Core actions. */
  notifies: z
    .array(z.object({ role: Identifier, by: z.enum(["email", "in_app"]) }))
    .default([]),
});

export const Rule = z.object({
  name: Identifier,
  statement: z.string().min(1),
  /** What happens if the rule is broken. Question bank, Rules. */
  on_breach: z.enum(["block_and_say_why", "allow_and_flag", "second_approver"]),
  /** "Their call" answers are the customer's own policy and are never recommended. */
  their_call: z.boolean().default(false),
});

export const AcceptanceItem = z.object({
  number: z.number().int().positive(),
  as_role: Identifier,
  does: z.string().min(1),
  sees: z.string().min(1),
});

export const AssumedChoice = z.object({
  about: z.string().min(1),
  chose: z.string().min(1),
  reason: z.string().min(1),
});

export const AppSpec = z.object({
  spec_version: z.literal(1),
  /** Working name for the app, lower_snake_case. */
  name: Identifier,
  /** Section 1: Purpose. */
  purpose: z.object({
    one_sentence: z.string().min(1),
    replaces: z.enum(["email_or_chat", "spreadsheet", "paper_or_pdf_form", "nothing_new", "something_else"]),
    who_feels_the_pain: z.array(z.enum(["submitters", "approvers", "reporters"])).min(1),
  }),
  /** Section 2: Users and roles. */
  roles: z.array(Role).min(1),
  sign_in: z.enum(["email_and_password", "company_email_sso_later"]),
  /** Section 3: Data. */
  entities: z.array(Entity).min(1),
  /** Section 4: Screens. */
  screens: z.array(Screen).min(1),
  /** Section 5: Core actions, three to five. */
  actions: z.array(Action).min(1).max(5),
  /** Section 6: Rules. */
  rules: z.array(Rule),
  must_never_happen: z.string().optional(),
  /** Section 7: Done means. */
  acceptance: z.array(AcceptanceItem).min(1),
  signs_off: z.array(Identifier).min(1),
  /** Anything deferred, with one line of reason. */
  later: z.array(z.object({ item: z.string().min(1), reason: z.string().min(1) })).default([]),
  /** Every choice made on the customer's behalf, listed for confirmation at acceptance. */
  assumed: z.array(AssumedChoice).default([]),
  /** Hosting inside the country flagged as required (recorded only, in Stage 1). */
  in_country_hosting_required: z.boolean().default(false),
  /** Which quality rules (1 to 10) the analyst added checks for. All ten always apply. */
  quality_rules_noted: z.array(z.number().int().min(1).max(10)).default([]),
});

export type AppSpec = z.infer<typeof AppSpec>;

/** Cross-field checks that a schema alone cannot express. Returns plain-language problems. */
export function checkReferences(spec: AppSpec): string[] {
  const problems: string[] = [];
  const roles = new Set(spec.roles.map((r) => r.name));
  const entities = new Set(spec.entities.map((e) => e.name));
  for (const s of spec.screens) {
    if (!roles.has(s.for_role)) problems.push(`Screen "${s.name}" is for unknown role "${s.for_role}".`);
    if (!entities.has(s.entity)) problems.push(`Screen "${s.name}" shows unknown entity "${s.entity}".`);
  }
  for (const a of spec.actions) {
    if (!roles.has(a.by_role)) problems.push(`Action "${a.name}" is by unknown role "${a.by_role}".`);
    for (const n of a.notifies) if (!roles.has(n.role)) problems.push(`Action "${a.name}" notifies unknown role "${n.role}".`);
  }
  for (const e of spec.entities)
    for (const f of e.fields) {
      if (f.type === "choice" && (!f.choices || f.choices.length === 0))
        problems.push(`Field "${e.name}.${f.name}" is a choice with no choices.`);
      if (f.type === "reference" && (!f.references || !entities.has(f.references)))
        problems.push(`Field "${e.name}.${f.name}" references an unknown entity.`);
    }
  for (const item of spec.acceptance)
    if (!roles.has(item.as_role)) problems.push(`Acceptance item ${item.number} is done as unknown role "${item.as_role}".`);
  for (const r of spec.signs_off) if (!roles.has(r)) problems.push(`Sign-off role "${r}" is unknown.`);
  const numbers = spec.acceptance.map((i) => i.number);
  if (new Set(numbers).size !== numbers.length) problems.push("Acceptance items must be numbered without repeats.");
  return problems;
}

/** Parse and check. Throws with plain-language problems on failure. */
export function loadAppSpec(input: unknown): AppSpec {
  const parsed = AppSpec.safeParse(input);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`The app spec is not valid:\n${lines.join("\n")}`);
  }
  const problems = checkReferences(parsed.data);
  if (problems.length > 0) throw new Error(`The app spec has problems:\n${problems.join("\n")}`);
  return parsed.data;
}
