export function ModeBanner({ paypalMode }: { paypalMode: "sandbox" | "mock" }) {
  if (paypalMode === "mock") {
    return (
      <div role="status" className="bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-ink-950">
        MOCK PayPal: no real or sandbox money moved
      </div>
    );
  }
  return (
    <div role="status" className="bg-mesh-500 px-4 py-2 text-center text-sm font-semibold text-ink-950">
      PayPal Sandbox — checkout hits the PayPal sandbox, not live money
    </div>
  );
}
