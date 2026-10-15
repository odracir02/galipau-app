// Shared helpers: extract .zip/.tar.gz archives and decrypt age backups.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Windows ships bsdtar (reads .zip and .tar.gz); elsewhere use tar/unzip
const TAR = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";

export const extraer = (archivo, destino) => {
  if (archivo.toLowerCase().endsWith(".zip") && process.platform !== "win32") execFileSync("unzip", ["-q", archivo, "-d", destino]);
  else execFileSync(TAR, ["-xf", archivo, "-C", destino]);
};

// Accepts the .age file or the .zip GitHub produces when downloading an artifact
export const descifrar = (archivo, clave, carpeta, nombre) => {
  let cifrado = archivo;
  if (archivo.toLowerCase().endsWith(".zip")) {
    const zip = path.join(carpeta, `${nombre}-zip`);
    fs.mkdirSync(zip);
    extraer(archivo, zip);
    const encontrados = fs.readdirSync(zip).filter((f) => f.endsWith(".age"));
    if (encontrados.length !== 1) throw new Error(`Expected one .age file inside ${archivo}, found ${encontrados.length}`);
    cifrado = path.join(zip, encontrados[0]);
  }
  const cabecera = fs.readFileSync(cifrado).subarray(0, 21).toString();
  if (cabecera !== "age-encryption.org/v1") throw new Error(`${path.basename(cifrado)} is not an age-encrypted file`);
  const tarGz = path.join(carpeta, `${nombre}.tar.gz`);
  execFileSync("age", ["--decrypt", "--identity", clave, "--output", tarGz, cifrado], { stdio: ["ignore", "ignore", "pipe"] });
  const salida = path.join(carpeta, nombre);
  fs.mkdirSync(salida);
  extraer(tarGz, salida);
  return { salida, cifrado };
};

