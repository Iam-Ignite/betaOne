import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

type Sealed = { iv: string; ct: string; tag: string };
export type EncryptedSecret = { v: 1; data: Sealed; dek: Sealed };

const b64 = (b: Buffer) => b.toString("base64");
const unb64 = (s: string) => Buffer.from(s, "base64");

function seal(key: Buffer, plaintext: Buffer): Sealed {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { iv: b64(iv), ct: b64(ct), tag: b64(c.getAuthTag()) };
}

function open(key: Buffer, s: Sealed): Buffer {
  const d = createDecipheriv("aes-256-gcm", key, unb64(s.iv));
  d.setAuthTag(unb64(s.tag));
  return Buffer.concat([d.update(unb64(s.ct)), d.final()]);
}

// DEV ONLY: replace with KMS Encrypt / Decrypt calls in production.
function kek(): Buffer {
  const k = Buffer.from(process.env.WALLET_KEK_BASE64 ?? "", "base64");
  if (k.length !== 32) throw new Error("WALLET_KEK_BASE64 must be 32 bytes (base64)");
  return k;
}

export function encryptSecret(secret: Uint8Array): EncryptedSecret {
  const dek = randomBytes(32);
  const data = seal(dek, Buffer.from(secret));
  const wrapped = seal(kek(), dek);
  dek.fill(0);
  return { v: 1, data, dek: wrapped };
}

export function decryptSecret(enc: EncryptedSecret): Uint8Array {
  const dek = open(kek(), enc.dek);
  try {
    return new Uint8Array(open(dek, enc.data));
  } finally {
    dek.fill(0);
  }
}
