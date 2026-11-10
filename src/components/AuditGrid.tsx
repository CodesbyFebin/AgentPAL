"use client";

import { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import type { AuditEvent } from "@/lib/types";

export function AuditGrid({ events }: { events: AuditEvent[] }) {
  const columnDefs = useMemo<ColDef[]>(
    () => [
      { field: "at", headerName: "Time", width: 200, sort: "desc" },
      { field: "type", headerName: "Event", width: 210 },
      { field: "message", headerName: "Message", flex: 1, minWidth: 280, wrapText: true, autoHeight: true },
      {
        field: "attribution",
        headerName: "Attribution",
        width: 260,
        cellClass: "text-mesh-400",
      },
      {
        field: "hash",
        headerName: "Chain hash",
        width: 180,
        valueFormatter: (p) => (p.value ? String(p.value).slice(0, 16) + "…" : ""),
      },
    ],
    [],
  );

  const rows = useMemo(
    () => events.map((e) => ({ ...e, attribution: e.attribution || "paid by agent on behalf of user" })),
    [events],
  );

  return (
    <div className="ag-theme-quartz-dark h-[420px] w-full overflow-hidden rounded-xl border border-white/10">
      <AgGridReact
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={{ resizable: true, sortable: true, filter: true }}
        animateRows
        rowHeight={42}
        getRowId={(p) => p.data.event_id}
      />
    </div>
  );
}
