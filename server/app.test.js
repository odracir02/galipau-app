import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import { levantarServidor } from "./pruebas/entorno.js";
import { importarCatalogo } from "./modules/catalogo/importar.js";
import { crearManejadorErrores, ErrorApi } from "./http/errores.js";
import { soloDesdeEstePc } from "./http/middleware.js";

let s;
beforeEach(async () => {
  s = await levantarServidor();
});
afterEach(async () => {
  await s.cerrar();
});

describe("API pública y protección", () => {
  it("salud responde sin sesión y con cabeceras de seguridad", async () => {
    const r = await s.pedir("/api/salud");
    expect(r.estado).toBe(200);
    expect(r.json).toMatchObject({ ok: true });
    expect(r.cabeceras.get("x-content-type-options")).toBe("nosniff");
    expect(r.cabeceras.get("x-frame-options")).toBe("DENY");
    expect(r.cabeceras.get("cache-control")).toBe("no-store");
    expect(r.cabeceras.get("x-powered-by")).toBeNull();
  });

  it.each(["/api/clientes", "/api/catalogo/productos", "/api/copias/estado"])("%s exige sesión", async (ruta) => {
    const r = await s.pedir(ruta);
    expect(r.estado).toBe(401);
    expect(r.json).toMatchObject({ codigo: "no_autenticado" });
  });

  it("estado de autenticación antes y después de configurar", async () => {
    expect((await s.pedir("/api/auth/estado")).json).toMatchObject({ configurado: false, autenticado: false, accesoLocal: true });
    await s.iniciarSesion();
    expect((await s.pedir("/api/auth/estado")).json).toMatchObject({ configurado: true, autenticado: true });
  });

  it("flujo completo: configurar → cookie HttpOnly → cerrar sesión → login", async () => {
    const conf = await s.pedir("/api/auth/configurar", { metodo: "POST", cuerpo: { contrasena: "clave-segura-1" } });
    expect(conf.estado).toBe(201);
    const cookie = conf.cabeceras.get("set-cookie");
    expect(cookie).toMatch(/galipau_sesion=.+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000/);
    expect((await s.pedir("/api/clientes")).estado).toBe(200);

    expect((await s.pedir("/api/auth/logout", { metodo: "POST" })).cabeceras.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await s.pedir("/api/clientes")).estado).toBe(401);

    expect((await s.pedir("/api/auth/login", { metodo: "POST", cuerpo: { contrasena: "mala-clave" } })).estado).toBe(401);
    expect((await s.pedir("/api/auth/login", { metodo: "POST", cuerpo: { contrasena: "clave-segura-1" } })).estado).toBe(200);
    expect((await s.pedir("/api/clientes")).estado).toBe(200);
  });

  it("una cookie inventada no da acceso", async () => {
    await s.iniciarSesion();
    s.olvidarCookie();
    const r = await s.pedir("/api/clientes", { cabeceras: { cookie: "galipau_sesion=inventada" } });
    expect(r.estado).toBe(401);
  });

  it("bloquea peticiones de otro origen (CSRF)", async () => {
    await s.iniciarSesion();
    const r = await s.pedir("/api/clientes", { metodo: "POST", cuerpo: { nombre: "X" }, cabeceras: { origin: "http://sitio-malicioso.example" } });
    expect(r.estado).toBe(403);
  });

  it("exige JSON en las peticiones con cuerpo", async () => {
    await s.iniciarSesion();
    const r = await s.pedir("/api/clientes", { metodo: "POST", cuerpo: "nombre=X", cabeceras: { "content-type": "application/x-www-form-urlencoded" } });
    expect(r.estado).toBe(415);
  });

  it("cambiar la contraseña desde la API", async () => {
    await s.iniciarSesion("clave-inicial");
    const r = await s.pedir("/api/auth/cambiar-contrasena", { metodo: "POST", cuerpo: { actual: "clave-inicial", nueva: "clave-nueva-2" } });
    expect(r.estado).toBe(200);
    expect((await s.pedir("/api/clientes")).estado).toBe(200); // current session kept
  });
});

describe("API de clientes", () => {
  beforeEach(() => s.iniciarSesion());

  it("crea, lista, busca, obtiene y actualiza", async () => {
    const creado = await s.pedir("/api/clientes", {
      metodo: "POST",
      cuerpo: { nombre: "  Club Ciclista  ", nif: "g-1234 5678", tipo: "asociacion", email: "club@example.com" },
    });
    expect(creado.estado).toBe(201);
    expect(creado.json).toMatchObject({ nombre: "Club Ciclista", nif: "G12345678", tipo: "asociacion", archivado: false, pais: "España" });

    await s.pedir("/api/clientes", { metodo: "POST", cuerpo: { nombre: "Bar Pepe" } });
    expect((await s.pedir("/api/clientes")).json.map((c) => c.nombre)).toEqual(["Bar Pepe", "Club Ciclista"]);
    expect((await s.pedir("/api/clientes?buscar=G1234")).json).toHaveLength(1);

    const id = creado.json.id;
    expect((await s.pedir(`/api/clientes/${id}`)).json.email).toBe("club@example.com");
    const editado = await s.pedir(`/api/clientes/${id}`, { metodo: "PATCH", cuerpo: { telefono: "600000000", archivado: true } });
    expect(editado.json).toMatchObject({ telefono: "600000000", archivado: true, nombre: "Club Ciclista" });
    expect((await s.pedir("/api/clientes")).json).toHaveLength(1);
    expect((await s.pedir("/api/clientes?archivados=1")).json).toHaveLength(2);
  });

  it("valida la entrada con mensajes claros", async () => {
    const casos = [
      [{}, "nombre", 400],
      [{ nombre: "   " }, "nombre", 400],
      [{ nombre: "A", email: "no-es-email" }, "email", 400],
      [{ nombre: "A", tipo: "vip" }, "tipo", 400],
      [{ nombre: "A", inventado: 1 }, "inventado", 400],
      [{ nombre: "x".repeat(201) }, "nombre", 400],
      [{ nombre: 42 }, "nombre", 400],
    ];
    for (const [cuerpo, campo, estado] of casos) {
      const r = await s.pedir("/api/clientes", { metodo: "POST", cuerpo });
      expect(r.estado, JSON.stringify(cuerpo)).toBe(estado);
      expect(r.json.campo).toBe(campo);
      expect(typeof r.json.error).toBe("string");
    }
  });

  it("NIF duplicado → 409 con mensaje propio", async () => {
    await s.pedir("/api/clientes", { metodo: "POST", cuerpo: { nombre: "A", nif: "B11111111" } });
    const r = await s.pedir("/api/clientes", { metodo: "POST", cuerpo: { nombre: "B", nif: "b-11111111" } });
    expect(r.estado).toBe(409);
    expect(r.json).toMatchObject({ error: "Ya existe un cliente con ese NIF.", campo: "nif" });
  });

  it("404 para clientes y rutas inexistentes; 400 para ids no válidos", async () => {
    expect((await s.pedir("/api/clientes/999")).estado).toBe(404);
    expect((await s.pedir("/api/clientes/999", { metodo: "PATCH", cuerpo: { notas: "x" } })).estado).toBe(404);
    expect((await s.pedir("/api/clientes/abc")).estado).toBe(400);
    expect((await s.pedir("/api/no-existe")).json).toMatchObject({ codigo: "no_encontrado" });
  });

  it("JSON mal formado → 400", async () => {
    const r = await s.pedir("/api/clientes", { metodo: "POST", cuerpo: "{mal json" });
    expect(r.estado).toBe(400);
    expect(r.json.error).toMatch(/JSON/);
  });
});

describe("API de catálogo", () => {
  it("devuelve el catálogo en el formato que usa la calculadora (coste en euros)", async () => {
    await s.iniciarSesion();
    importarCatalogo(s.bd, [{ tipo: "Camiseta", proveedor: "Demo", modelo: "Básica", talla: "M", color: "Negro", coste: "2.35" }]);
    const r = await s.pedir("/api/catalogo/productos");
    expect(r.json).toEqual([{ id: expect.any(String), tipo: "Camiseta", proveedor: "Demo", modelo: "Básica", talla: "M", color: "Negro", costeCent: 235, coste: 2.35 }]);
    expect((await s.pedir("/api/catalogo/resumen")).json).toEqual({ proveedores: 1, modelos: 1, variantes: 1 });
  });
});

describe("mantenimiento y errores", () => {
  it("durante una restauración la API responde 503 (salvo salud)", async () => {
    await s.iniciarSesion();
    const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(s.bd), "enMantenimiento");
    Object.defineProperty(s.bd, "enMantenimiento", { get: () => true, configurable: true });
    expect((await s.pedir("/api/clientes")).estado).toBe(503);
    expect((await s.pedir("/api/salud")).estado).toBe(200);
    Object.defineProperty(s.bd, "enMantenimiento", original);
  });

  it("los errores inesperados devuelven 500 sin detalles internos", async () => {
    const app = express();
    app.get("/roto", () => {
      throw new Error("secreto interno: /ruta/privada");
    });
    app.use(crearManejadorErrores({ error: () => {} }));
    const servidor = app.listen(0, "127.0.0.1");
    await new Promise((r) => servidor.once("listening", r));
    const r = await fetch(`http://127.0.0.1:${servidor.address().port}/roto`);
    const cuerpo = await r.json();
    servidor.close();
    expect(r.status).toBe(500);
    expect(cuerpo).toEqual({ error: "Error interno del servidor.", codigo: "error_interno" });
  });

  it("las operaciones sensibles solo se permiten desde el propio PC", () => {
    const llamar = (remoteAddress) => {
      let resultado;
      soloDesdeEstePc({ socket: { remoteAddress } }, {}, (e) => (resultado = e));
      return resultado;
    };
    expect(llamar("127.0.0.1")).toBeUndefined();
    expect(llamar("::1")).toBeUndefined();
    expect(llamar("192.168.1.40")).toBeInstanceOf(ErrorApi);
    expect(llamar("192.168.1.40").estado).toBe(403);
  });
});
