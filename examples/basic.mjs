const baseUrl = process.argv[2] ?? "http://localhost:3000";

try {
  const response = await fetch(new URL("/api/health", baseUrl), {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const { ok, paymentMode, aiMode } = await response.json();
  if (ok !== true) throw new Error("AgentPaL reported an unhealthy status");

  console.log({ ok, paymentMode, aiMode });
} catch (error) {
  console.error(`Health check failed for ${baseUrl}: ${error.message}`);
  process.exitCode = 1;
}
