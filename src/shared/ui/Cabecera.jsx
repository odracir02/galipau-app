// Page header: title, optional description and actions aligned to the right
function Cabecera({ titulo, descripcion, acciones, nivel = 1, children }) {
  const Titulo = `h${nivel}`;
  return (
    <header className="gx-cabecera">
      <div>
        <Titulo>{titulo}</Titulo>
        {descripcion && <p>{descripcion}</p>}
        {children}
      </div>
      {acciones && <div className="gx-cabecera-acciones">{acciones}</div>}
    </header>
  );
}

export default Cabecera;
