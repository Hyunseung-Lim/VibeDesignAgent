"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface AdminDataTableColumn<Row> {
  key: string;
  label: string;
  /** Extra classes for body cells, e.g. width caps and wrapping. */
  cellClassName?: string;
  render: (row: Row) => ReactNode;
}

interface AdminDataTableProps<Row> {
  columns: AdminDataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  emptyMessage?: string;
  /** min-width class for the table so dense tables scroll horizontally. */
  tableClassName?: string;
}

/** Dense admin table with a sticky header inside a scrollable container. */
export function AdminDataTable<Row>({
  columns,
  rows,
  rowKey,
  emptyMessage = "데이터 없음",
  tableClassName,
}: AdminDataTableProps<Row>) {
  if (rows.length === 0) {
    return (
      <p className="px-6 py-4 text-sm text-muted-foreground">{emptyMessage}</p>
    );
  }
  return (
    <table
      className={cn(
        "w-full border-separate border-spacing-0 text-left text-xs text-muted-foreground",
        tableClassName,
      )}
    >
      <thead className="sticky top-0 z-10 bg-card text-muted-foreground shadow-[0_1px_0_0_rgba(226,232,240,1)]">
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              className="border-b border-border px-3 py-2 font-semibold"
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} className="align-top hover:bg-muted/60">
            {columns.map((column) => (
              <td
                key={column.key}
                className={cn(
                  "border-b border-border px-3 py-3",
                  column.cellClassName,
                )}
              >
                {column.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
