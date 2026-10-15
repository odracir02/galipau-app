#!/usr/bin/env bash
# Restores an encrypted Galipau App database backup into a Supabase project.
# Intended for restore drills on the TEST project and for disaster recovery.
#
# Requirements: age, PostgreSQL 17 client tools (pg_restore, psql), Supabase CLI.
# Usage:
#   ./restaurar.sh <backup.tar.gz.age> <age-identity-file> <target-db-url> <owner-email>
#
# Steps:
#   1. Decrypt and unpack the backup into a private temporary folder.
#   2. The target project must already have the schema: run `supabase db push`
#      against it first (same migrations as the app).
#   3. Load the data only (pg_restore --data-only), in a single transaction.
#   4. Re-link the owner account (auth users are not part of the backup).
#   5. Compare the manifest of the restored data with the one in the backup.

set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "Usage: $0 <backup.tar.gz.age> <age-identity-file> <target-db-url> <owner-email>" >&2
  exit 1
fi

COPIA="$1"; IDENTIDAD="$2"; DESTINO="$3"; EMAIL="$4"
DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
umask 077

echo "Decrypting $COPIA..."
age --decrypt --identity "$IDENTIDAD" --output "$TMP/copia.tar.gz" "$COPIA"
tar -C "$TMP" -xzf "$TMP/copia.tar.gz"
test -s "$TMP/galipau.dump" && test -s "$TMP/manifiesto-origen.json"

filas=$(psql "$DESTINO" -qtAX -v ON_ERROR_STOP=1 -c "select (select count(*) from public.propietario) + (select count(*) from public.clientes) + (select count(*) from public.variantes) + (select count(*) from public.presupuestos) + (select count(*) from public.configuracion)")
if [ "$filas" != "0" ]; then
  echo "The target database already contains data ($filas rows). Restore only into an empty project." >&2
  exit 1
fi

echo "Loading data..."
pg_restore --dbname "$DESTINO" --data-only --single-transaction --exit-on-error --no-owner --no-privileges "$TMP/galipau.dump"

echo "Re-linking the owner account ($EMAIL)..."
psql "$DESTINO" -q -v ON_ERROR_STOP=1 -v email="$EMAIL" \
  -c "update public.propietario set user_id = (select id from auth.users where email = :'email')"
psql "$DESTINO" -qtAX -v ON_ERROR_STOP=1 -v email="$EMAIL" \
  -c "select count(*) from public.propietario p join auth.users u on u.id = p.user_id where u.email = :'email'" | grep -qx 1 \
  || { echo "Owner account not found: create the user in Supabase Auth first." >&2; exit 1; }

echo "Verifying..."
psql "$DESTINO" -qtAX -v ON_ERROR_STOP=1 -f "$DIR/manifiesto.sql" > "$TMP/manifiesto-restaurado.json"
# propietario.user_id was re-linked on purpose, so that table is expected to differ
node --input-type=module -e "
  import { compararManifiestos, leerManifiesto } from '$DIR/verificar-manifiesto.mjs';
  const d = compararManifiestos(leerManifiesto('$TMP/manifiesto-origen.json'), leerManifiesto('$TMP/manifiesto-restaurado.json'))
    .filter((x) => !x.startsWith('propietario:'));
  if (d.length) { console.error('Verification FAILED:'); d.forEach((x) => console.error('  - ' + x)); process.exit(1); }
  console.log('Restore verified: data identical to the backup.');
"
