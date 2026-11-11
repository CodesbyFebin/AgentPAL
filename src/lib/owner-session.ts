export const OWNER_SESSION = "agentpal_owner_session";
export const SESSION_SECONDS = 8 * 60 * 60;

export function ownerSessionRequired() {
  return Boolean(process.env.AGENTPAL_OWNER_KEY || process.env.PAYPAL_CLIENT_SECRET ||
    process.env.BRAINTREE_PRIVATE_KEY || process.env.AI_API_KEY);
}

const encoder = new TextEncoder();

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function validOwnerKey(candidate: string) {
  const expected = process.env.AGENTPAL_OWNER_KEY;
  if (!expected || expected.length < 32 || candidate.length > 256) return false;
  const [a, b] = await Promise.all([digest(candidate), digest(expected)]);
  return a.reduce((difference, byte, index) => difference | (byte ^ b[index]), 0) === 0;
}

async function signSession(value: string) {
  const secret = process.env.AGENTPAL_OWNER_KEY;
  if (!secret || secret.length < 32) return null;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function issueOwnerSession() {
  const value = `${Date.now() + SESSION_SECONDS * 1000}.${crypto.randomUUID()}`;
  const signature = await signSession(value);
  return signature ? `${value}.${signature}` : null;
}

export async function verifyOwnerSession(session: string | undefined) {
  if (!session || !/^\d{13}\.[\da-f-]{36}\.[\da-f]{64}$/.test(session)) return false;
  const [expiry, nonce, signature] = session.split(".");
  if (Number(expiry) <= Date.now()) return false;
  const expected = await signSession(`${expiry}.${nonce}`);
  return Boolean(expected && Array.from(expected).reduce((diff, char, index) => diff | (char.charCodeAt(0) ^ signature.charCodeAt(index)), 0) === 0);
}
