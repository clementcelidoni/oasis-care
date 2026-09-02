"use client";

import { deleteExpense } from "@/lib/finance/actions";

export function DeleteExpenseButton({ expenseId }: { expenseId: string }) {
  return (
    <form action={deleteExpense}>
      <input type="hidden" name="expense_id" value={expenseId} />
      <button type="submit" className="px-1 text-xs text-ink-faint hover:text-critical">
        &#10005;
      </button>
    </form>
  );
}
