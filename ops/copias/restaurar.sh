#!/usr/bin/env bash
# Restores a decrypted Galipau App database backup into an EMPTY Supabase project
# (disaster recovery or restore drill on a test project). Never use it on a
# database that already contains data.
#
# Requirements: PostgreSQL client (psql), Node 22+.
# Before running:
#   1. Decrypt the backup: node ops/copias/descifrar.mjs --clave key.txt --copia <backup> --destino <folder>
#   2. In the new project: apply the app migrations (`supabase db push`, or run the
#      files in supabase/migrations in the SQL editor) and create the owner user.
# Usage:
#   ./restaurar.sh <decrypted folder> "<session pooler url>" <owner-email>

set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <decrypted folder> <target-db-url> <owner-email>" >&2
  exit 1
fi

CARPETA="$1"; DESTINO="$2"; EMAIL="$3"
DIR="$(cd "$(dirname "$0")" && pwd)"
for f in datos.sql manifiesto.json; do test -s "$CARPETA/$f" || { echo "Missing $f in $CARPETA" >&2; exit 1; }; done

filas=$(psql "$DESTINO" -qtAX -v ON_ERROR_STOP=1 -c "select (select count(*) from public.propietario) + (select count(*) from public.clientes) + (select count(*) from public.variantes) + (select count(*) from public.presupuestos) + (select count(*) from public.configuracion)")
if [ "$filas" != "0" ]; then
  echo "The target database already contains data ($filas rows). Restore only into an empty project." >&2
  exit 1
fi

echo "Loading data (single transaction)..."
psql "$DESTINO" -q -v ON_ERROR_STOP=1 --single-transaction -f "$CARPETA/datos.sql"

echo "Re-linking the owner account ($EMAIL)..."
psql "$DESTINO" -q -v ON_ERROR_STOP=1 -v email="$EMAIL" \
  -c "update public.propietario set user_id = (select id from auth.users where email = :'email')"
psql "$DESTINO" -qtAX -v ON_ERROR_STOP=1 -v email="$EMAIL" \
  -c "select count(*) from public.propietario p join auth.users u on u.id = p.user_id where u.email = :'email'" | grep -qx 1 \
  || { echo "Owner account not found: create the user in Supabase Auth first." >&2; exit 1; }

echo "Verifying..."
psql "$DESTINO" -qtAX -v ON_ERROR_STOP=1 -f "$DIR/manifiesto.sql" > "$CARPETA/manifiesto-restaurado.json"
# propietario.user_id was re-linked on purpose, so that table is expected to differ
node --input-type=module -e "
  import { compararManifiestos, leerManifiesto } from '$DIR/verificar-manifiesto.mjs';
  const d = compararManifiestos(leerManifiesto('$CARPETA/manifiesto.json'), leerManifiesto('$CARPETA/manifiesto-restaurado.json'))
    .filter((x) => !x.startsWith('propietario:'));
  if (d.length) { console.error('Verification FAILED:'); d.forEach((x) => console.error('  - ' + x)); process.exit(1); }
  console.log('Restore verified: data identical to the backup.');
"
