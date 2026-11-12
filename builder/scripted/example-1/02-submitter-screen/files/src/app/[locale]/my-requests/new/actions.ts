// Written by the scripted engine (fixed change example-1/02-submitter-screen). No AI model wrote this.
"use server";

import { db } from "@/db";
import { leaveRequest } from "@/db/app-schema";
import { guardedAction } from "@/lib/roles";
import { checkLeaveRequest, type SubmitResult } from "../rules";

// Rule 5: only an employee can send a leave request, and only as themselves: the request is saved
// for the signed-in user, whatever the form says. Rule 1: the same checks as the form, again here.
// Not done in this step: the balance check and telling the manager (the example's employee record
// and notifications come in later steps).
export const submitLeaveRequest = guardedAction(["employee"], async (user, input: unknown): Promise<SubmitResult> => {
  const checked = checkLeaveRequest(input);
  if (!checked.ok) return { ok: false, problems: checked.problems };
  const { startDate, endDate, days, reason } = checked.value;
  try {
    await db.insert(leaveRequest).values({
      employee: user.userId,
      startDate,
      endDate,
      days,
      reason,
      status: "waiting",
      createdBy: user.userId,
      updatedBy: user.userId,
    });
  } catch {
    // Rule 3: the person is told that nothing was saved and what to do, never a code.
    return { ok: false, saveFailed: true };
  }
  return { ok: true };
});
