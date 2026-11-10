import { generateKeyPairSync, sign as nodeSign, verify as nodeVerify, createHash } from "crypto";
import { canonicalJson } from "./ids";

export interface KeyPairPem {
  publicKeyPem: string;
  privateKeyPem: string;
}

export function generateEd25519Pem(): KeyPairPem {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function signPayload(payload: unknown, privateKeyPem: string): string {
  const message = Buffer.from(canonicalJson(payload), "utf8");
  const signature = nodeSign(null, message, privateKeyPem);
  return signature.toString("base64");
}

export function verifyPayload(
  payload: unknown,
  publicKeyPem: string,
  signatureB64: string,
): boolean {
  const message = Buffer.from(canonicalJson(payload), "utf8");
  return nodeVerify(null, message, publicKeyPem, Buffer.from(signatureB64, "base64"));
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function chainHash(prevHash: string, body: unknown): string {
  return sha256Hex(`${prevHash}\n${canonicalJson(body)}`);
}
