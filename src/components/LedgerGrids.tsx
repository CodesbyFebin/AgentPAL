"use client";

import { useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ICellRendererParams, RowClickedEvent } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { formatINR, formatMoney } from "@/lib/money";
import type { AuditEvent, LedgerTxn, Payment, Receipt } from "@/lib/types";

function csvButton(api: { exportDataAsCsv?: (opts: { fileName: string }) => void } | null, name: string) {
  return (
    <button
      type="button"
      className="rounded-lg border border-white/15 px-3 py-1 text-xs text-zinc-200 hover:border-mesh-500"
      onClick={() => api?.exportDataAsCsv?.({ fileName: name })}
    >
      Export CSV
    </button>
  );
}

function AmountCell(props: ICellRendererParams) {
  const value = Number(props.value ?? 0);
  const ccy = props.data?.currency || "INR";
  const positive = value > 0;
  return (
    <span className={positive ? "font-medium text-mesh-400" : "font-medium text-rose-300"}>
      {formatMoney(value, ccy)}
    </span>
  );
}

export function TransactionsGrid({
  transactions,
  payments,
  receipts = [],
}: {
  transactions: LedgerTxn[];
  payments: Payment[];
  receipts?: Receipt[];
}) {
  const gridRef = useRef<AgGridReact<LedgerTxn>>(null);
  const [selected, setSelected] = useState<LedgerTxn | null>(null);
  const paymentFor = (txn: LedgerTxn) => payments.find((p) => p.payment_id === txn.payment_id);
  const policyOf = (p?: Payment) => {
    if (!p) return "—";
    if (p.status === "denied") return "DENY";
    if (p.approval === "human") return "REQUIRE_APPROVAL";
    if (p.approval === "auto") return "ALLOW";
    return "—";
  };
  const receiptOf = (p?: Payment) => {
    if (!p) return "—";
    const rec = receipts.find((r) => r.payments.includes(p.payment_id));
    return rec?.receipt_id ?? "—";
  };

  const columnDefs = useMemo<ColDef[]>(
    () => [
      { field: "posted_at", headerName: "Posted", width: 190, sort: "desc" },
      {
        headerName: "Month",
        width: 110,
        valueGetter: (p) => (p.data as LedgerTxn | undefined)?.posted_at?.slice(0, 7) ?? "",
      },
      { field: "category", headerName: "Category", width: 140 },
      { field: "merchant", headerName: "Merchant", flex: 1, minWidth: 160 },
      { field: "account_id", headerName: "Account", width: 160 },
      {
        field: "amount",
        headerName: "Amount",
        width: 140,
        cellRenderer: AmountCell,
        type: "numericColumn",
      },
      {
        headerName: "Approval",
        width: 130,
        valueGetter: (p) => paymentFor(p.data as LedgerTxn)?.approval ?? (p.data?.source === "seed" ? "demo" : "—"),
      },
      {
        headerName: "Policy",
        width: 140,
        valueGetter: (p) => policyOf(paymentFor(p.data as LedgerTxn)),
      },
      {
        headerName: "Receipt",
        width: 160,
        valueGetter: (p) => receiptOf(paymentFor(p.data as LedgerTxn)),
      },
      {
        headerName: "Status",
        width: 130,
        valueGetter: (p) => paymentFor(p.data as LedgerTxn)?.status ?? (p.data?.demo ? "seeded" : "posted"),
        cellClassRules: {
          "text-mesh-400": (p) => String(p.value).includes("captured") || String(p.value) === "settled",
          "text-amber-300": (p) => String(p.value).includes("awaiting"),
          "text-rose-300": (p) => ["denied", "failed", "voided"].includes(String(p.value)),
        },
      },
      { field: "source", headerName: "Source", width: 130 },
    ],
    [payments, receipts],
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Transactions ledger · filter or sort by category or merchant (Community grid)</p>
        {csvButton(gridRef.current?.api ?? null, "agentpal-transactions.csv")}
      </div>
      <div className="ag-theme-quartz-dark h-[380px] w-full overflow-hidden rounded-xl border border-white/10">
        <AgGridReact
          ref={gridRef}
          rowData={transactions}
          columnDefs={columnDefs}
          defaultColDef={{ resizable: true, sortable: true, filter: true }}
          animateRows
          rowHeight={38}
          getRowId={(p) => p.data.txn_id}
          onRowClicked={(e: RowClickedEvent<LedgerTxn>) => setSelected(e.data ?? null)}
        />
      </div>
      {selected && (
        <div className="mt-3 rounded-xl border border-white/10 bg-ink-900/80 p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Transaction detail</p>
              <h3 className="mt-1 font-display text-lg text-white">{selected.merchant}</h3>
              <p className="text-zinc-300">
                {formatMoney(selected.amount, selected.currency)} · {selected.category} · {selected.posted_at}
              </p>
              <p className="mt-2 text-zinc-400">{selected.note}</p>
              {selected.demo && <p className="mt-2 text-xs text-amber-300">Seeded demo data — not a live bank feed.</p>}
            </div>
            <button type="button" className="text-xs text-zinc-400 hover:text-white" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AuditTrailGrid({ events }: { events: AuditEvent[] }) {
  const gridRef = useRef<AgGridReact<AuditEvent>>(null);
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const columnDefs = useMemo<ColDef[]>(
    () => [
      { field: "at", headerName: "Time", width: 200, sort: "desc" },
      { field: "type", headerName: "Event", width: 230 },
      {
        headerName: "Family",
        width: 140,
        valueGetter: (p) => String(p.data?.type.split(".")[0] || ""),
      },
      { field: "message", headerName: "Message", flex: 1, minWidth: 260, wrapText: true, autoHeight: true },
      { field: "attribution", headerName: "Attribution", width: 240 },
      {
        field: "hash",
        headerName: "Chain hash",
        width: 160,
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
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Hash-chained audit trail · click a row to expand the payload in a detail drawer</p>
        {csvButton(gridRef.current?.api ?? null, "agentpal-audit.csv")}
      </div>
      <div className="ag-theme-quartz-dark h-[420px] w-full overflow-hidden rounded-xl border border-white/10">
        <AgGridReact
          ref={gridRef}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={{ resizable: true, sortable: true, filter: true }}
          animateRows
          rowHeight={42}
          getRowId={(p) => p.data.event_id}
          onRowClicked={(e: RowClickedEvent<AuditEvent>) => setSelected(e.data ?? null)}
        />
      </div>
      {selected && (
        <div className="mt-3 rounded-xl border border-white/10 bg-ink-900/80 p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Audit record</p>
              <h3 className="mt-1 font-display text-lg text-white">{selected.type}</h3>
              <p className="text-zinc-300">{selected.message}</p>
              <p className="mt-2 font-mono text-[11px] text-zinc-500 break-all">
                hash {selected.hash}
                <br />
                prev {selected.prev_hash}
              </p>
              <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-black/40 p-3 text-[11px] text-zinc-300">
                {JSON.stringify(selected.payload, null, 2)}
              </pre>
            </div>
            <button type="button" className="text-xs text-zinc-400 hover:text-white" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function formatInrLabel(n: number) {
  return formatINR(n);
}
