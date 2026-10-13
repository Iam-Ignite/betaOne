/**
 * KMS-backed encryption for production.
 * Swap this in for `crypto.ts` when you have AWS KMS / GCP KMS / Vault access.
 *
 * Usage:
 *   import { encryptSecretKms, decryptSecretKms, type KmsEncryptedSecret } from "./crypto.kms";
 *
 * The format is similar to crypto.ts but with v=2 and KMS-wrapped DEK.
 * Legacy v1 secrets (WALLET_KEK_BASE64) are handled by crypto.ts.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EncryptedSecret as LegacyEncryptedSecret } from "./crypto";

/** KMS-backed encrypted secret format (v2). */
export interface KmsEncryptedSecret {
  v: 2;
  data: Sealed;           // AES-256-GCM encrypted payload (the actual secret)
  dek: KmsWrappedDek;     // DEK wrapped by KMS
}

export interface Sealed {
  iv: string;  // base64
  ct: string;  // base64 ciphertext
  tag: string; // base64 auth tag
}

export interface KmsWrappedDek {
  ct: string;   // base64 KMS ciphertext of the DEK
  keyId: string; // KMS key identifier for rotation
}

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

/** KMS provider interface — implement for your provider. */
export interface KmsProvider {
  /** Encrypt a 32-byte DEK. Returns base64 ciphertext + key ID for rotation. */
  encrypt(dek: Buffer): Promise<{ ciphertext: string; keyId: string }>;
  /** Decrypt a DEK given its ciphertext + key ID. Returns 32-byte plaintext. */
  decrypt(ciphertext: string, keyId: string): Promise<Buffer>;
}

/** No-op provider for local dev (falls back to WALLET_KEK_BASE64 via crypto.ts). */
export class DevKmsProvider implements KmsProvider {
  private kek: Buffer;

  constructor() {
    const k = Buffer.from(process.env.WALLET_KEK_BASE64 ?? "", "base64");
    if (k.length !== 32) throw new Error("WALLET_KEK_BASE64 must be 32 bytes (base64)");
    this.kek = k;
  }

  async encrypt(dek: Buffer) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.kek, iv);
    const ct = Buffer.concat([c.update(dek), c.final()]);
    return { ciphertext: b64(ct), keyId: "dev-v1" };
  }

  async decrypt(ciphertext: string, _keyId: string): Promise<Buffer> {
    // Dev provider doesn't actually use KMS decrypt — legacy format handled by crypto.ts
    // This should never be called for v2 secrets in dev mode.
    throw new Error("DevKmsProvider.decrypt not used — use crypto.ts for v1 secrets");
  }
}

/** AWS KMS provider (requires @aws-sdk/client-kms). */
export class AwsKmsProvider implements KmsProvider {
  private client: any;
  private keyId: string;
  private EncryptCommand: any;
  private DecryptCommand: any;

  constructor(keyId: string, region = "us-east-1") {
    const { KMSClient, EncryptCommand, DecryptCommand } = require("@aws-sdk/client-kms");
    this.client = new KMSClient({ region });
    this.keyId = keyId;
    this.EncryptCommand = EncryptCommand;
    this.DecryptCommand = DecryptCommand;
  }

  async encrypt(dek: Buffer) {
    const cmd = new this.EncryptCommand({ KeyId: this.keyId, Plaintext: dek });
    const res = await this.client.send(cmd);
    return { ciphertext: b64(res.CiphertextBlob!), keyId: this.keyId };
  }

  async decrypt(ciphertext: string, keyId: string): Promise<Buffer> {
    const cmd = new this.DecryptCommand({ CiphertextBlob: unb64(ciphertext), KeyId: keyId });
    const res = await this.client.send(cmd);
    return res.Plaintext!;
  }
}

/** GCP KMS provider (requires @google-cloud/kms). */
export class GcpKmsProvider implements KmsProvider {
  private client: any;
  private keyName: string;

  constructor(keyName: string) {
    const { KeyManagementServiceClient } = require("@google-cloud/kms");
    this.client = new KeyManagementServiceClient();
    this.keyName = keyName;
  }

  async encrypt(dek: Buffer) {
    const [res] = await this.client.encrypt({ name: this.keyName, plaintext: dek });
    return { ciphertext: b64(res.ciphertext!), keyId: this.keyName };
  }

  async decrypt(ciphertext: string, keyId: string): Promise<Buffer> {
    const [res] = await this.client.decrypt({ name: keyId, ciphertext: unb64(ciphertext) });
    return res.plaintext!;
  }
}

/** HashiCorp Vault Transit provider (requires node-vault). */
export class VaultTransitProvider implements KmsProvider {
  private vault: any;
  private transitPath: string;
  private keyName: string;

  constructor(vaultAddr: string, token: string, transitPath = "transit", keyName = "copytrade") {
    const nodeVault = require("node-vault");
    this.vault = nodeVault({ endpoint: vaultAddr, token });
    this.transitPath = transitPath;
    this.keyName = keyName;
  }

  async encrypt(dek: Buffer) {
    const res = await this.vault.write(`${this.transitPath}/encrypt/${this.keyName}`, {
      plaintext: b64(dek),
    });
    return { ciphertext: res.data.ciphertext, keyId: `${this.transitPath}/${this.keyName}` };
  }

  async decrypt(ciphertext: string, keyId: string): Promise<Buffer> {
    const res = await this.vault.write(`${this.transitPath}/decrypt/${this.keyName}`, {
      ciphertext,
    });
    return unb64(res.data.plaintext);
  }
}

/** Factory: pick provider from env. */
let _provider: KmsProvider | null = null;

export function getKmsProvider(): KmsProvider {
  if (_provider) return _provider;

  const provider = process.env.KMS_PROVIDER ?? "dev";

  switch (provider) {
    case "aws":
      if (!process.env.AWS_KMS_KEY_ID) throw new Error("AWS_KMS_KEY_ID required");
      _provider = new AwsKmsProvider(process.env.AWS_KMS_KEY_ID, process.env.AWS_REGION);
      break;
    case "gcp":
      if (!process.env.GCP_KMS_KEY_NAME) throw new Error("GCP_KMS_KEY_NAME required");
      _provider = new GcpKmsProvider(process.env.GCP_KMS_KEY_NAME);
      break;
    case "vault":
      if (!process.env.VAULT_ADDR || !process.env.VAULT_TOKEN)
        throw new Error("VAULT_ADDR and VAULT_TOKEN required");
      _provider = new VaultTransitProvider(
        process.env.VAULT_ADDR,
        process.env.VAULT_TOKEN,
        process.env.VAULT_TRANSIT_PATH,
        process.env.VAULT_KEY_NAME,
      );
      break;
    case "dev":
    default:
      _provider = new DevKmsProvider();
      break;
  }

  return _provider!;
}

/** Encrypt a secret (Solana private key / EVM private key) using KMS-wrapped DEK. */
export async function encryptSecretKms(secret: Uint8Array): Promise<KmsEncryptedSecret> {
  const dek = randomBytes(32);
  const kms = getKmsProvider();
  const { ciphertext, keyId } = await kms.encrypt(dek);

  const data = seal(dek, Buffer.from(secret));
  dek.fill(0);

  return { v: 2, data, dek: { ct: ciphertext, keyId } };
}

/** Decrypt a secret using KMS to unwrap the DEK. */
export async function decryptSecretKms(enc: KmsEncryptedSecret): Promise<Uint8Array> {
  const kms = getKmsProvider();
  const dek = await kms.decrypt(enc.dek.ct, enc.dek.keyId);
  try {
    return new Uint8Array(open(dek, enc.data));
  } finally {
    dek.fill(0);
  }
}

/** Migrate a v1 (legacy) encrypted secret to v2 (KMS). */
export async function migrateToKms(legacyEnc: LegacyEncryptedSecret): Promise<KmsEncryptedSecret> {
  const { decryptSecret: legacyDecrypt } = await import("./crypto");
  const plaintext = legacyDecrypt(legacyEnc);
  return encryptSecretKms(plaintext);
}