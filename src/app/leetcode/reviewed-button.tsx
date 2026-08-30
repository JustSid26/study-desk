"use client";

/**
 * "Reviewed" on a revisit-queue row. Client-side only because it needs a click
 * handler, a pending state and somewhere to show a failed action's message —
 * the server action returns `{ok:false,error}` rather than throwing.
 */
import * as React from "react";
import { markReviewed } from "@/app/actions/problems";
import { Button } from "@/components/ui";

export function ReviewedButton({ id, title }: { id: string; title: string }) {
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  return (
    <>
      <Button
        size="sm"
        disabled={pending}
        aria-label={`Mark ${title} reviewed`}
        onClick={() => {
          setError(null);
          start(async () => {
            const res = await markReviewed(id);
            if (!res.ok) setError(res.error);
          });
        }}
      >
        {pending ? "Saving" : "Reviewed"}
      </Button>
      {error ? (
        <span role="status" className="text-[11.5px] leading-snug text-flame">
          {error}
        </span>
      ) : null}
    </>
  );
}
