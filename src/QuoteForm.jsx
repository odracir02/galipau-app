import { useState } from 'react';

function QuoteForm() {
  const [clientName, setClientName] = useState('');
  const [itemType, setItemType] = useState('Camiseta');
  const [sizeEntries, setSizeEntries] = useState([
    { size: '', quantity: '', colorType: 'Blanca' }
  ]);
  const [printType, setPrintType] = useState('DTF');
  const [submittedData, setSubmittedData] = useState(null);

  const availableSizes = ['S', 'M', 'L', 'XL', '2XL', '3XL'];

  const handleSizeChange = (index, field, value) => {
    const updated = [...sizeEntries];
    updated[index][field] = value;
    setSizeEntries(updated);
  };

  const addSizeEntry = () => {
    setSizeEntries([...sizeEntries, { size: '', quantity: '', colorType: 'Blanca' }]);
  };

  const removeSizeEntry = (index) => {
    const updated = [...sizeEntries];
    updated.splice(index, 1);
    setSizeEntries(updated);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!clientName.trim()) return alert('Por favor introduce el nombre del cliente.');

    const cleanEntries = sizeEntries.filter(entry => entry.quantity && entry.size);
    setSubmittedData({
      clientName,
      itemType,
      printType,
      sizeEntries: cleanEntries
    });
  };

  const usedSizes = sizeEntries.map(entry => `${entry.size}-${entry.colorType}`);

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
            onChange={(e) => setClientName(e.target.value)}
            required
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
          {sizeEntries.map((entry, index) => {
            const selectedKey = `${entry.size}-${entry.colorType}`;
            const filteredSizes = availableSizes.filter(size => {
              const key = `${size}-${entry.colorType}`;
              return !usedSizes.includes(key) || key === selectedKey;
            });

            return (
              <div className="row g-2 mb-2" key={index}>
                <div className="col-md-3">
                  <select
                    className="form-select"
                    value={entry.size}
                    onChange={(e) => handleSizeChange(index, 'size', e.target.value)}
                    required
                  >
                    <option value="">Talla</option>
                    {filteredSizes.map(size => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                </div>
                <div className="col-md-3">
                  <input
                    type="number"
                    min="1"
                    className="form-control"
                    value={entry.quantity}
                    onChange={(e) => handleSizeChange(index, 'quantity', e.target.value)}
                    required
                  />
                </div>
                <div className="col-md-3">
                  <select
                    className="form-select"
                    value={entry.colorType}
                    onChange={(e) => handleSizeChange(index, 'colorType', e.target.value)}
                  >
                    <option value="Blanca">Blanca</option>
                    <option value="Color">Color</option>
                  </select>
                </div>
                <div className="col-md-3">
                  <button type="button" className="btn btn-danger w-100" onClick={() => removeSizeEntry(index)}>Eliminar</button>
                </div>
              </div>
            );
          })}
          <button type="button" className="btn btn-secondary" onClick={addSizeEntry}>+ Añadir otra línea</button>
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

      {submittedData && (
        <div className="mt-5">
          <h4 className="mb-3">🧾 Datos recogidos</h4>
          <table className="table">
            <tbody>
              <tr>
                <th>Cliente</th>
                <td>{submittedData.clientName}</td>
              </tr>
              <tr>
                <th>Tipo de prenda</th>
                <td>{submittedData.itemType}</td>
              </tr>
              <tr>
                <th>Estampado</th>
                <td>{submittedData.printType}</td>
              </tr>
              <tr>
                <th>Detalles</th>
                <td>
                  <ul>
                    {submittedData.sizeEntries.map((entry, i) => (
                      <li key={i}>{entry.quantity} × {entry.size} ({entry.colorType})</li>
                    ))}
                  </ul>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default QuoteForm;
