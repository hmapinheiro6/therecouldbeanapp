import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const context = Buffer.from("therecouldbeanapp/full-d1-backup/v1");
export const MAX_PLAIN = 128 * 1024 * 1024,
  MAX_ENCRYPTED = 64 * 1024 * 1024;
function key(secret, salt) {
  if (typeof secret !== "string" || secret.length < 32)
    throw new Error("Missing backup key");
  return hkdfSync("sha256", secret, salt, context, 32);
}
export function seal(plain, secret) {
  if (plain.length > MAX_PLAIN)
    throw new Error("Backup exceeds plaintext budget");
  const salt = randomBytes(32),
    iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(secret, salt), iv);
  cipher.setAAD(context);
  const data = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
  const envelope = Buffer.from(
    JSON.stringify({
      version: 1,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    }),
  );
  if (envelope.length > MAX_ENCRYPTED)
    throw new Error("Backup exceeds encrypted storage budget");
  return envelope;
}
export function open(envelope, secret) {
  if (envelope.length > MAX_ENCRYPTED)
    throw new Error("Backup exceeds size limit");
  const e = JSON.parse(envelope.toString());
  if (e.version !== 1) throw new Error("Unsupported backup version");
  const salt = Buffer.from(e.salt, "base64"),
    iv = Buffer.from(e.iv, "base64"),
    tag = Buffer.from(e.tag, "base64");
  if (salt.length !== 32 || iv.length !== 12 || tag.length !== 16)
    throw new Error("Invalid backup metadata");
  const cipher = createDecipheriv("aes-256-gcm", key(secret, salt), iv);
  cipher.setAAD(context);
  cipher.setAuthTag(tag);
  return gunzipSync(
    Buffer.concat([
      cipher.update(Buffer.from(e.data, "base64")),
      cipher.final(),
    ]),
    { maxOutputLength: MAX_PLAIN },
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [, , mode, input, output] = process.argv;
    if (!["seal", "open"].includes(mode) || !input || !output)
      throw new Error("Invalid backup command");
    const value = (mode === "seal" ? seal : open)(
      readFileSync(input),
      process.env.INTERNAL_SECRET,
    );
    writeFileSync(output, value, { mode: 0o600 });
  } catch {
    console.error(
      "Backup authentication/encryption failed. Existing backup preserved.",
    );
    process.exitCode = 1;
  }
}
