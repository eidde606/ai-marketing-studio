
import { useState, type FormEvent } from 'react';
import {
  createBusiness,
  type Business,
  type BusinessCreate,
} from '../services/businessesApi';

type Props = {
  onCreated: (business: Business) => void;
  onCancel: () => void;
};

export default function BusinessForm({ onCreated, onCancel }: Props) {
  const [form, setForm] = useState<BusinessCreate>({
    name: '',
    description: '',
    target_audience: '',
    brand_voice: '',
    industry: '',
    products_services: '',
    service_area: '',
    website_url: '',
    marketing_goals: '',
    preferred_platforms: '',
    posting_frequency: '',
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateField = (field: keyof BusinessCreate, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!form.name?.trim() || saving) return;

    setSaving(true);
    setError(null);

    try {
      const business = await createBusiness({
        ...form,
        name: form.name.trim(),
      });

      onCreated(business);
    } catch {
      setError('No se pudo guardar el negocio. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel business-form-panel">
      <h2>Agregar negocio</h2>
      <p>
        Cuéntanos sobre tu negocio para que el equipo IA pueda
        crear estrategias y contenido personalizado.
      </p>

      <form onSubmit={handleSubmit}>
        <label htmlFor="business-name">Nombre del negocio *</label>
        <input
          id="business-name"
          required
          maxLength={120}
          value={form.name}
          onChange={(event) => updateField('name', event.target.value)}
          placeholder="Ej. Latitude Food Fusion"
        />

        <label htmlFor="business-industry">Tipo de negocio</label>
        <input
          id="business-industry"
          value={form.industry ?? ''}
          onChange={(event) => updateField('industry', event.target.value)}
          placeholder="Ej. Restaurante, entretenimiento, tienda online"
        />

        <label htmlFor="business-description">Descripción</label>
        <textarea
          id="business-description"
          value={form.description ?? ''}
          onChange={(event) => updateField('description', event.target.value)}
          placeholder="Describe tu negocio y lo que lo hace especial"
        />

        <label htmlFor="business-products">Productos o servicios</label>
        <textarea
          id="business-products"
          value={form.products_services ?? ''}
          onChange={(event) =>
            updateField('products_services', event.target.value)
          }
          placeholder="Ej. Encebollado, cazuela, bolones y comida ecuatoriana"
        />

        <label htmlFor="business-audience">Público objetivo</label>
        <textarea
          id="business-audience"
          value={form.target_audience ?? ''}
          onChange={(event) =>
            updateField('target_audience', event.target.value)
          }
          placeholder="¿A qué tipo de clientes quieres llegar?"
        />

        <label htmlFor="business-area">Zona de servicio</label>
        <input
          id="business-area"
          value={form.service_area ?? ''}
          onChange={(event) => updateField('service_area', event.target.value)}
          placeholder="Ej. Richmond, Hopewell y Petersburg, Virginia"
        />

        <label htmlFor="business-voice">Estilo de comunicación</label>
        <input
          id="business-voice"
          value={form.brand_voice ?? ''}
          onChange={(event) => updateField('brand_voice', event.target.value)}
          placeholder="Ej. Familiar, alegre, profesional"
        />

        <label htmlFor="business-website">Sitio web</label>
        <input
          id="business-website"
          type="url"
          value={form.website_url ?? ''}
          onChange={(event) => updateField('website_url', event.target.value)}
          placeholder="https://tusitio.com"
        />

        <label htmlFor="business-goals">Objetivos de marketing</label>
        <textarea
          id="business-goals"
          value={form.marketing_goals ?? ''}
          onChange={(event) =>
            updateField('marketing_goals', event.target.value)
          }
          placeholder="Ej. Aumentar pedidos, conseguir reservas, atraer clientes"
        />

        <label htmlFor="business-platforms">Redes sociales preferidas</label>
        <input
          id="business-platforms"
          value={form.preferred_platforms ?? ''}
          onChange={(event) =>
            updateField('preferred_platforms', event.target.value)
          }
          placeholder="Ej. Instagram, Facebook, TikTok"
        />

        <label htmlFor="business-frequency">
          Frecuencia de publicaciones
        </label>
        <select
          id="business-frequency"
          value={form.posting_frequency ?? ''}
          onChange={(event) =>
            updateField('posting_frequency', event.target.value)
          }
          style={{
            width: '100%',
            minHeight: 44,
            padding: '0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: 10,
            background: '#fff',
            font: 'inherit',
          }}
        >
          <option value="">Seleccionar frecuencia</option>
          <option value="daily">Todos los días</option>
          <option value="5_per_week">5 veces por semana</option>
          <option value="3_per_week">3 veces por semana</option>
          <option value="weekly">Una vez por semana</option>
          <option value="manual">Según sea necesario</option>
        </select>

        {error && <p role="alert">{error}</p>}

        <div className="business-form-actions">
          <button
            type="button"
            className="reject-button"
            onClick={onCancel}
            disabled={saving}
          >
            Cancelar
          </button>

          <button
            type="submit"
            className="primary-button"
            disabled={saving || !form.name?.trim()}
          >
            {saving ? 'Guardando...' : 'Guardar negocio'}
          </button>
        </div>
      </form>
    </section>
  );
}
