# Encrypted backups (GitHub Actions)

Backups run in a **separate private repository**, never in the public app repository.

| Workflow | What | When | Kept |
|---|---|---|---|
| `copia-base-datos.yml` | All app data (`public` schema) as `esquema.sql` + `datos.sql` | Daily, 03:17 UTC | Daily artifact for 30 days. Monthly release for 12 months |
| `copia-archivos.yml` | Files in the Storage bucket `archivos` | Weekly, Sunday 03:41 UTC | Last 4 weekly releases |

How a backup is accepted:
- **Database:** both dumps and a manifest (row count + checksum per table) come from **one consistent snapshot**. The dump is restored into a temporary PostgreSQL 17 in the same run and must match the manifest, with Row Level Security still enabled.
- **Storage:** every file is checked against the SHA-256 recorded at download time.

Everything is then encrypted with [age](https://age-encryption.org/) to the owner's public key, and the plaintext is deleted from the runner. Each run:
- writes its result to `public.registro_copias` (shown in the app);
- writes a summary on the run page;
- opens an issue labelled `copia-fallida` on failure (GitHub emails it) and closes it after the next successful backup.

Both workflows refuse to run if the repository is not private. The schedule exists for recovery purposes (24 h recovery point); it is not intended to keep the Supabase project active.

## GitHub Free limits (private repository)

- **2,000 Actions minutes per month.** Usage is **blocked**, not billed, without a payment method. Expected: about 3 min/day plus about 3 min/week.
- **500 MB of artifact storage**, shared with Packages. Encrypted dumps are small and artifacts expire after 30 days. Each backup above 100 MiB fails on purpose.
- **Release assets:** up to 2 GiB per file. The Supabase Free plan allows 1 GB of Storage.

## Setup (once)

1. **age key pair, on the owner's computer.** On Windows: `winget install FiloSottile.age`, then:
   ```bash
   age-keygen -o galipau-copias.key
   ```
   The `# public key: age1...` line is the public key. Keep the `.key` file (the private key) **outside GitHub**, in two safe places.
2. **Private repository:** create it with these two workflow files in `.github/workflows/`.
3. **Variables:**
   - `AGE_RECIPIENT` = the `age1...` public key
   - `APP_REPOSITORY` = `odracir02/galipau-app`
4. **Secrets:**
   - `SUPABASE_DB_URL`: Supabase → Connect → **Session pooler** string (port 5432, IPv4; GitHub runners have no IPv6)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`: secret key, used only by the Storage workflow
5. **Start with a test project** (fictitious data), run both workflows, and do a restore drill before pointing the secrets to production.

## Restore drill (owner's computer, nothing is written anywhere)

```bash
node ops/copias/simulacro.mjs --clave galipau-copias.key --base <db backup .zip or .age> --archivos <files backup .zip or .age>
```

The drill:
1. decrypts both backups into a temporary folder;
2. restores the database into an isolated in-process PostgreSQL, twice:
   - with the schema from the backup;
   - with the app migrations plus the data, which is the emergency path;
3. checks relations, amounts, RLS and constraints;
4. verifies every file checksum;
5. deletes all decrypted files.

## Disaster recovery

1. **Decrypt** the latest backup into a new folder:
   ```bash
   node ops/copias/descifrar.mjs --clave galipau-copias.key --copia <backup> --destino <new folder>
   ```
2. **Prepare an empty Supabase project:**
   - apply the app migrations (`supabase db push`, or run `supabase/migrations/*.sql` in the SQL editor);
   - create the owner user in Authentication.
3. **Load the data:**
   ```bash
   ./restaurar.sh <folder> "<session pooler url>" owner@example.com
   ```
   For small databases, you can instead paste `datos.sql` in the SQL editor and then run the owner re-link query documented in the script.
4. **Files:** decrypt the latest Storage backup, then run `node ops/copias/copiar-storage.mjs subir <folder>` (with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set). It verifies checksums first and never overwrites existing objects.
5. **Clean up:** delete the decrypted folders.
