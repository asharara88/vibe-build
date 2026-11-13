// Written by the scripted engine (fixed change example-1/01-data). No AI model wrote this.
/**
 * The app's own tables, for test example 1 (leave requests). The template's sign-in tables stay in
 * schema.ts, which the build engine must not change; drizzle.config.ts names both files.
 *
 * Only the leave-request table, enough for acceptance item 1. The example's employee record (name,
 * manager, annual balance) is not here: `employee` points at the template's user table instead.
 * That is a deviation from the example spec, which the real engine builds later.
 */
import { sql } from "drizzle-orm";
import { check, date, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { stamps, user } from "./schema";

/** The spec's own status values, in its order. A new request is waiting. */
export const LEAVE_STATUSES = ["waiting", "approved", "rejected", "withdrawn"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const leaveRequest = pgTable(
  "leave_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The employee who asks for leave: a user of the app. */
    employee: text("employee")
      .notNull()
      .references(() => user.id),
    /** First day of leave. */
    startDate: date("start_date", { mode: "string" }).notNull(),
    /** Last day of leave. */
    endDate: date("end_date", { mode: "string" }).notNull(),
    /** Working days requested, typed by the employee (the app does not work out public holidays). */
    days: integer("days").notNull(),
    reason: text("reason"),
    status: text("status", { enum: LEAVE_STATUSES }).notNull().default("waiting"),
    /** The manager's note, written when a request is decided (a later step). */
    decisionNote: text("decision_note"),
    // Rule 4: who created the row and when, who last changed it and when.
    ...stamps(),
  },
  (t) => [
    check("leave_request_status_known", sql`${t.status} in ('waiting', 'approved', 'rejected', 'withdrawn')`),
    check("leave_request_last_day_not_before_first", sql`${t.endDate} >= ${t.startDate}`),
    check("leave_request_days_within_range", sql`${t.days} >= 1 and ${t.days} <= (${t.endDate} - ${t.startDate} + 1)`),
  ],
);
