import Link from "next/link";
export default function PayPalCancelPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <p className="text-xs uppercase tracking-[0.2em] text-amber-400">AgentPaL · checkout cancelled</p>
      <h1 className="mt-3 font-display text-3xl text-white">Approval cancelled</h1>
      <p className="mt-4 text-zinc-300">
        The PayPal checkout was cancelled. The authorization was not created and nothing was captured.
      </p>
      <Link href="/" className="mt-8 inline-block text-mesh-400 underline-offset-4 hover:underline">
        Back to AgentPaL
      </Link>
    </main>
  );
}
