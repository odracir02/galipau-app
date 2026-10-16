// Product identity in one place. The interface reads names, logo and colours
// from here and from the theme tokens (tema/tema.css), never hard-coded in
// components, so the product can be re-branded without touching the screens.
// The workshop's own data (name, tax id, address…) lives in "Empresa y PDF".

export const MARCA = Object.freeze({
  producto: "Galipau App",
  descripcion: "Gestión para talleres de personalización textil",
  logo: "/galipauLogo.jpeg",
  iniciales: "GA",
  pie: "Galipau Arts · Galipau App",
});
