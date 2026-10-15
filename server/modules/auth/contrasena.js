// Password hashing with scrypt (memory-hard KDF, built into Node).
// Stored format: scrypt$N$r$p$saltBase64$hashBase64 so parameters can be raised later.

import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";

const PARAMETROS = { N: 2 ** 15, r: 8, p: 1 };
const LONGITUD = 64;
const MEMORIA_MAX = 128 * 1024 * 1024;

const derivar = (contrasena, sal, { N, r, p }) =>
  new Promise((resolve, reject) =>
    scrypt(contrasena.normalize("NFKC"), sal, LONGITUD, { N, r, p, maxmem: MEMORIA_MAX }, (err, clave) =>
      err ? reject(err) : resolve(clave)
    )
  );

export const MIN_LONGITUD = 8;
export const MAX_LONGITUD = 200;

export const hashContrasena = async (contrasena) => {
  const sal = randomBytes(16);
  const clave = await derivar(contrasena, sal, PARAMETROS);
  const { N, r, p } = PARAMETROS;
  return `scrypt$${N}$${r}$${p}$${sal.toString("base64")}$${clave.toString("base64")}`;
};

export const verificarContrasena = async (contrasena, almacenado) => {
  const partes = typeof almacenado === "string" ? almacenado.split("$") : [];
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [, N, r, p, sal, hash] = partes;
  const esperado = Buffer.from(hash, "base64");
  const obtenido = await derivar(contrasena, Buffer.from(sal, "base64"), { N: Number(N), r: Number(r), p: Number(p) });
  return obtenido.length === esperado.length && timingSafeEqual(obtenido, esperado);
};

export const necesitaActualizar = (almacenado) => {
  const [, N, r, p] = String(almacenado).split("$");
  return Number(N) < PARAMETROS.N || Number(r) !== PARAMETROS.r || Number(p) !== PARAMETROS.p;
};
