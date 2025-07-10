import { useState, useEffect } from 'react';
import { getProductos } from './services/getProductos';

function QuoteForm() {
  const [clientName, setClientName] = useState('');
  const [itemType, setItemType] = useState('Camiseta');
  const [printType, setPrintType] = useState('DTF');
  const [sizeEntries, setSizeEntries] = useState([
    { proveedor: '', modelo: '', color: '', size: '', quantity: '', id: Date.now() }
  ]);
  const [productos, setProductos] = useState([]);

  useEffect(() => {
    const fetchProductos = async () => {
      const data = await getProductos();
      console.log('📦 Productos desde Firebase:', data);
      setProductos(data);
    };

    fetchProductos();
  }, []);

  const handleChange = (index, field, value) => {
    const updated = [...sizeEntries];
    updated[index][field] = value;
    setSizeEntries(updated);
  };

  const addSizeEntry = () => {
    setSizeEntries([
      ...sizeEntries,
      { proveedor: '', modelo: '', color: '', size: '', quantity: '', id: Date.now() }
    ]);
  };

  const removeSizeEntry = (index) => {
    const updated = [...sizeEntries];
    updated.splice(index, 1);
    setSizeEntries(updated);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const validEntries = sizeEntries.filter(
      (entry) => entry.quantity && entry.size && entry.proveedor && entry.modelo && entry.color
    );
    const formData = {
      clientName,
      itemType,
      printType,
      sizeEntries: validEntries,
    };
    console.log('🧾 Datos recogidos:', formData);
  };

  return (
    <div className="container mt-5">
      <h2 className="mb-4">Generar presupuesto</h2>
      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <label className="form-label">Nombre del cliente</label>
          <input
            type="text"
            className="form-control"
            value={clientName}
            required
            onChange={(e) => setClientName(e.target.value)}
          />
        </div>

        <div className="mb-3">
          <label className="form-label">Tipo de prenda</label>
          <select className="form-select" value={itemType} onChange={(e) => setItemType(e.target.value)}>
            <option>Camiseta</option>
            <option>Sudadera</option>
            <option>Polo</option>
          </select>
        </div>

        <div className="mb-3">
          <label className="form-label">Tallas, cantidades y tipo</label>
          {sizeEntries.map((entry, index) => (
            <div className="row g-2 mb-2" key={entry.id}>
              <div className="col-md-2">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Proveedor"
                  value={entry.proveedor}
                  required
                  onChange={(e) => handleChange(index, 'proveedor', e.target.value)}
                />
              </div>
              <div className="col-md-2">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Modelo"
                  value={entry.modelo}
                  required
                  onChange={(e) => handleChange(index, 'modelo', e.target.value)}
                />
              </div>
              <div className="col-md-2">
                <select
                  className="form-select"
                  value={entry.color}
                  required
                  onChange={(e) => handleChange(index, 'color', e.target.value)}
                >
                  <option value="">Tipo de color</option>
                  <option value="Blanca">Blanca</option>
                  <option value="Color">Color</option>
                </select>
              </div>
              <div className="col-md-2">
                <select
                  className="form-select"
                  value={entry.size}
                  required
                  onChange={(e) => handleChange(index, 'size', e.target.value)}
                >
                  <option value="">Talla</option>
                  <option>S</option>
                  <option>M</option>
                  <option>L</option>
                  <option>XL</option>
                  <option>2XL</option>
                  <option>3XL</option>
                </select>
              </div>
              <div className="col-md-2">
                <input
                  type="number"
                  min="1"
                  required
                  placeholder="Cantidad"
                  className="form-control"
                  value={entry.quantity}
                  onChange={(e) => handleChange(index, 'quantity', e.target.value)}
                />
              </div>
              <div className="col-md-2">
                <button type="button" className="btn btn-danger w-100" onClick={() => removeSizeEntry(index)}>
                  Eliminar
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="btn btn-secondary" onClick={addSizeEntry}>
            + Añadir otra línea
          </button>
        </div>

        <div className="mb-3">
          <label className="form-label d-block">Tipo de estampado</label>
          <div className="form-check form-check-inline">
            <input
              className="form-check-input"
              type="radio"
              name="estampado"
              value="DTF"
              checked={printType === 'DTF'}
              onChange={(e) => setPrintType(e.target.value)}
            />
            <label className="form-check-label">DTF</label>
          </div>
          <div className="form-check form-check-inline">
            <input
              className="form-check-input"
              type="radio"
              name="estampado"
              value="Serigrafía"
              checked={printType === 'Serigrafía'}
              onChange={(e) => setPrintType(e.target.value)}
            />
            <label className="form-check-label">Serigrafía</label>
          </div>
        </div>

        <button type="submit" className="btn btn-primary">Calcular presupuesto</button>
      </form>

      {/* TEMPORAL: Verificación visual de datos cargados desde Firebase */}
      <div className="mt-5">
        <h4>🧩 Productos cargados desde Firebase:</h4>
        <ul>
          {productos.map((p) => (
            <li key={p.id}>
              {p.proveedor} - {p.modelo} - {p.color} - {p.talla} - {p.precio} €
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default QuoteForm;
