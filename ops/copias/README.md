# Encrypted backups (GitHub Actions)

Backups run in a **separate private repository**, never in the public app repository. Two scheduled workflows:

| Workflow | What | When | Kept |
|---|---|---|---|
| `copia-base-datos.yml` | `public` schema dump (all app data) | Daily, 03:17 UTC | Daily artifact for 30 days. Monthly release for 12 months |
| `copia-archivos.yml` | Files in the Storage bucket `archivos` | Weekly, Sunday 03:41 UTC | Last 4 weekly releases |

A backup is **accepted only after verification**:
- **Database:** the dump is restored into a temporary PostgreSQL 17 inside the job, and a manifest (row count + checksum of every table) must match the source.
- **Storage:** every file is checked against the SHA-256 recorded at download time.

Then everything is encrypted with [age](https://age-encryption.org/) to the owner's public key and the plaintext is deleted from the runner. Each run writes its result to `public.registro_copias`, which the app shows. Failures open an issue in the private repository, which sends an email notification.

The schedule exists for recovery purposes (24 h recovery point). It is not intended to keep the Supabase project active. A paused project must be restored from the Supabase dashboard.

## GitHub Free limits (private repository)

- 2,000 Actions minutes per month. Usage is **blocked**, not billed, when no payment method is configured. Expected usage: about 2 min/day plus about 5 min/week.
- 500 MB artifact storage (shared with Packages). Daily encrypted dumps are small; artifacts expire after 30 days.
- Release assets: up to 2 GiB per file. The Supabase Free plan allows 1 GB of Storage, so a weekly archive fits.

## Setup (once)

1. **age key pair** (on your own computer):
   ```bash
   age-keygen -o galipau-copias.key
   ```
   - The line `# public key: age1...` is the **public key**.
   - Keep `galipau-copias.key` (the private key) **outside GitHub**, in two safe places (for example a password manager and a USB drive). Without it, backups cannot be decrypted.
2. **Private repository** (e.g. `galipau-copias`): create it and copy the two files from `workflows/` into `.github/workflows/`.
3. **Variables** (Settings → Secrets and variables → Actions → Variables):
   - `AGE_RECIPIENT` = the `age1...` public key
   - `APP_REPOSITORY` = `odracir02/galipau-app`
4. **Secrets** (same page → Secrets):
   - `SUPABASE_DB_URL`: in Supabase, Connect → *Session pooler* connection string (port 5432, IPv4), with the database password. GitHub runners have no IPv6, so the direct connection string does not work.
   - `SUPABASE_URL`: `https://<project>.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY`: secret key, used only by the Storage workflow.
5. **Start with the TEST project** (fictitious data). Run both workflows manually (Actions → Run workflow) and check that they succeed. Then do a restore drill (below). Only then point the secrets to the production project.

## Restore drill / disaster recovery

1. Download a backup (artifact or release asset).
2. Prepare an **empty** Supabase project:
   - apply the schema: `supabase link --project-ref <ref>` and then `supabase db push`;
   - create the owner user in Authentication.
3. Run:
   ```bash
   ./restaurar.sh galipau-db-<stamp>.tar.gz.age galipau-copias.key "<session pooler url>" owner@example.com
   ```
   The script decrypts, loads the data in a single transaction, re-links the owner account (authentication users are not part of the backup) and verifies the manifest.
4. **Storage files:** decrypt the weekly archive, check `manifiesto-archivos.json`, and upload the `archivos/` folder to the bucket.

Repeat the drill every few months: a backup that has never been restored is not a backup.
