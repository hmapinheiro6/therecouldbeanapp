import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const context = Buffer.from("therecouldbeanapp/cloud-discovery-state/v1");
export const MAX_ENCRYPTED_BYTES = 1024 * 1024;
const MAX_PLAIN_BYTES = 16 * 1024 * 1024;
function key(secret, salt) {
  if (typeof secret !== "string" || secret.length < 32)
    throw new Error("Missing cloud-state key");
  return hkdfSync("sha256", secret, salt, context, 32);
}
export function seal(plain, secret) {
  if (plain.length > MAX_PLAIN_BYTES)
    throw new Error("Cloud journal exceeds plaintext safety limit");
  const salt = randomBytes(32),
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret, salt), iv);
  cipher.setAAD(context);
  const encrypted = Buffer.concat([
    cipher.update(gzipSync(plain)),
    cipher.final(),
  ]);
  const envelope = Buffer.from(
    JSON.stringify({
      version: 1,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: encrypted.toString("base64"),
    }),
  );
  if (envelope.length > MAX_ENCRYPTED_BYTES)
    throw new Error(
      "Encrypted cloud journal exceeds 1 MiB; stop and drain the review backlog",
    );
  return envelope;
}
export function open(envelope, secret) {
  if (envelope.length > MAX_ENCRYPTED_BYTES)
    throw new Error("Encrypted state exceeds limit");
  const value = JSON.parse(envelope.toString());
  if (value.version !== 1)
    throw new Error("Unsupported encrypted state version");
  const salt = Buffer.from(value.salt, "base64"),
    iv = Buffer.from(value.iv, "base64"),
    tag = Buffer.from(value.tag, "base64");
  if (salt.length !== 32 || iv.length !== 12 || tag.length !== 16)
    throw new Error("Invalid encrypted state metadata");
  const cipher = createDecipheriv("aes-256-gcm", key(secret, salt), iv);
  cipher.setAAD(context);
  cipher.setAuthTag(tag);
  const compressed = Buffer.concat([
    cipher.update(Buffer.from(value.data, "base64")),
    cipher.final(),
  ]);
  return gunzipSync(compressed, { maxOutputLength: MAX_PLAIN_BYTES });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [, , mode, input, output] = process.argv;
    if (!["seal", "open"].includes(mode) || !input || !output)
      throw new Error("Invalid cloud-state command");
    const value = (mode === "seal" ? seal : open)(
      readFileSync(input),
      process.env.INTERNAL_SECRET,
    );
    writeFileSync(output, value, { mode: 0o600 });
  } catch {
    console.error(
      "Cloud state encryption/decryption failed. Existing cloud checkpoint must not be replaced or reset.",
    );
    process.exitCode = 1;
  }
}
