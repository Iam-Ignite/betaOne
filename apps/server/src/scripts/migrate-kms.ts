#!/usr/bin/env tsx
/**
 * Migrate all encrypted secrets from v1 (WALLET_KEK_BASE64) to v2 (KMS).
 * Run ONCE after configuring KMS_PROVIDER and before enabling LIVE_TRADING_ALLOWED.
 *
 * Usage:
 *   KMS_PROVIDER=aws AWS_KMS_KEY_ID=... pnpm --filter server migrate-kms
 *   KMS_PROVIDER=gcp GCP_KMS_KEY_NAME=... pnpm --filter server migrate-kms
 *   KMS_PROVIDER=vault VAULT_ADDR=... VAULT_TOKEN=... pnpm --filter server migrate-kms
 */

import { db, decryptSecret, type EncryptedSecret, encryptSecretKms, type KmsEncryptedSecret } from "@copytrade/core";

async function main() {
  console.log(`[${new Date().toISOString()}] Starting KMS migration...`);

  // Verify KMS is configured
  const provider = process.env.KMS_PROVIDER;
  if (!provider || provider === "dev") {
    console.error("❌ KMS_PROVIDER must be set to 'aws', 'gcp', or 'vault' (not 'dev')");
    process.exit(1);
  }
  console.log(`Using KMS provider: ${provider}`);

  // Migrate Wallet records (user pass-through wallets)
  const wallets = await db.wallet.findMany({
    select: { id: true, encrypted: true, evmEncrypted: true },
  });

  console.log(`Found ${wallets.length} wallets to migrate...`);

  let migrated = 0;
  let errors = 0;

  for (const w of wallets) {
    try {
      // Solana key
      const solEnc = w.encrypted as EncryptedSecret;
      if (solEnc.v === 1) {
        const plaintext = decryptSecret(solEnc);
        const newEnc = await encryptSecretKms(plaintext);
        await db.wallet.update({ where: { id: w.id }, data: { encrypted: newEnc as any } });
        console.log(`  ✅ Migrated wallet ${w.id} (SOL)`);
        migrated++;
      }

      // EVM key (if exists)
      if (w.evmEncrypted) {
        const evmEnc = w.evmEncrypted as EncryptedSecret;
        if (evmEnc.v === 1) {
          const plaintext = decryptSecret(evmEnc);
          const newEnc = await encryptSecretKms(plaintext);
          await db.wallet.update({ where: { id: w.id }, data: { evmEncrypted: newEnc as any } });
          console.log(`  ✅ Migrated wallet ${w.id} (EVM)`);
          migrated++;
        }
      }
    } catch (e) {
      console.error(`  ❌ Failed to migrate wallet ${w.id}:`, e);
      errors++;
    }
  }

  // Migrate Pool wallet
  const poolSetting = await db.setting.findUnique({ where: { key: "pool_sol_encrypted" } });
  if (poolSetting) {
    try {
      const poolEnc = JSON.parse(poolSetting.value) as EncryptedSecret;
      if (poolEnc.v === 1) {
        const plaintext = decryptSecret(poolEnc);
        const newEnc = await encryptSecretKms(plaintext);
        await db.setting.update({ where: { key: "pool_sol_encrypted" }, data: { value: JSON.stringify(newEnc) } });
        console.log(`  ✅ Migrated pool wallet`);
        migrated++;
      }
    } catch (e) {
      console.error(`  ❌ Failed to migrate pool wallet:`, e);
      errors++;
    }
  }

  console.log(`\n=== MIGRATION COMPLETE ===`);
  console.log(`Migrated: ${migrated}`);
  console.log(`Errors: ${errors}`);

  if (errors > 0) {
    console.error("⚠️ Some migrations failed. Check logs and re-run after fixing.");
    process.exit(1);
  }

  console.log("✅ All secrets migrated to KMS. You can now enable LIVE_TRADING_ALLOWED=true");
  process.exit(0);
}

main().catch((e) => {
  console.error("Migration fatal error:", e);
  process.exit(2);
});