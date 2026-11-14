
import { useState, type FormEvent } from 'react';
import {
  createBusiness,
  type Business,
  type BusinessCreate,
} from '../services/businessesApi';
import { useLocalization } from '../app/localization';

type Props = {
  onCreated: (business: Business) => void;
  onCancel: () => void;
};

export default function BusinessForm({ onCreated, onCancel }: Props) {
  const { t } = useLocalization();
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
      setError(t('businessForm.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel business-form-panel">
      <h2>{t('businessForm.title')}</h2>
      <p>{t('businessForm.description')}</p>

      <form onSubmit={handleSubmit}>
        <label htmlFor="business-name">{t('businessForm.name')} *</label>
        <input
          id="business-name"
          required
          maxLength={120}
          value={form.name}
          onChange={(event) => updateField('name', event.target.value)}
          placeholder={t('businessForm.namePlaceholder')}
        />

        <label htmlFor="business-industry">{t('businessForm.industry')}</label>
        <input
          id="business-industry"
          value={form.industry ?? ''}
          onChange={(event) => updateField('industry', event.target.value)}
          placeholder={t('businessForm.industryPlaceholder')}
        />

        <label htmlFor="business-description">
          {t('businessForm.descriptionLabel')}
        </label>
        <textarea
          id="business-description"
          value={form.description ?? ''}
          onChange={(event) => updateField('description', event.target.value)}
          placeholder={t('businessForm.descriptionPlaceholder')}
        />

        <label htmlFor="business-products">{t('businessForm.products')}</label>
        <textarea
          id="business-products"
          value={form.products_services ?? ''}
          onChange={(event) =>
            updateField('products_services', event.target.value)
          }
          placeholder={t('businessForm.productsPlaceholder')}
        />

        <label htmlFor="business-audience">{t('businessForm.audience')}</label>
        <textarea
          id="business-audience"
          value={form.target_audience ?? ''}
          onChange={(event) =>
            updateField('target_audience', event.target.value)
          }
          placeholder={t('businessForm.audiencePlaceholder')}
        />

        <label htmlFor="business-area">{t('businessForm.area')}</label>
        <input
          id="business-area"
          value={form.service_area ?? ''}
          onChange={(event) => updateField('service_area', event.target.value)}
          placeholder={t('businessForm.areaPlaceholder')}
        />

        <label htmlFor="business-voice">{t('businessForm.voice')}</label>
        <input
          id="business-voice"
          value={form.brand_voice ?? ''}
          onChange={(event) => updateField('brand_voice', event.target.value)}
          placeholder={t('businessForm.voicePlaceholder')}
        />

        <label htmlFor="business-website">{t('businessForm.website')}</label>
        <input
          id="business-website"
          type="url"
          value={form.website_url ?? ''}
          onChange={(event) => updateField('website_url', event.target.value)}
          placeholder="https://tusitio.com"
        />

        <label htmlFor="business-goals">{t('businessForm.goals')}</label>
        <textarea
          id="business-goals"
          value={form.marketing_goals ?? ''}
          onChange={(event) =>
            updateField('marketing_goals', event.target.value)
          }
          placeholder={t('businessForm.goalsPlaceholder')}
        />

        <label htmlFor="business-platforms">
          {t('businessForm.platforms')}
        </label>
        <input
          id="business-platforms"
          value={form.preferred_platforms ?? ''}
          onChange={(event) =>
            updateField('preferred_platforms', event.target.value)
          }
          placeholder={t('businessForm.platformsPlaceholder')}
        />

        <label htmlFor="business-frequency">
          {t('businessForm.frequency')}
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
          <option value="">{t('businessForm.chooseFrequency')}</option>
          <option value="daily">{t('businessForm.frequency.daily')}</option>
          <option value="5_per_week">{t('businessForm.frequency.five')}</option>
          <option value="3_per_week">{t('businessForm.frequency.three')}</option>
          <option value="weekly">{t('businessForm.frequency.weekly')}</option>
          <option value="manual">{t('businessForm.frequency.manual')}</option>
        </select>

        {error && <p role="alert">{error}</p>}

        <div className="business-form-actions">
          <button
            type="button"
            className="reject-button"
            onClick={onCancel}
            disabled={saving}
          >
            {t('businessForm.cancel')}
          </button>

          <button
            type="submit"
            className="primary-button"
            disabled={saving || !form.name?.trim()}
          >
            {saving
              ? t('businessForm.saving')
              : t('businessForm.save')}
          </button>
        </div>
      </form>
    </section>
  );
}
