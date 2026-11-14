CREATE TABLE "leave_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" integer NOT NULL,
	"reason" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "leave_request_status_known" CHECK ("leave_request"."status" in ('waiting', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "leave_request_last_day_not_before_first" CHECK ("leave_request"."end_date" >= "leave_request"."start_date"),
	CONSTRAINT "leave_request_days_within_range" CHECK ("leave_request"."days" >= 1 and "leave_request"."days" <= ("leave_request"."end_date" - "leave_request"."start_date" + 1))
);
--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_employee_user_id_fk" FOREIGN KEY ("employee") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;