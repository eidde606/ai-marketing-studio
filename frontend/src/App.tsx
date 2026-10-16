

import { useEffect, useMemo, useRef, useState, type FC } from 'react';

import {

  approveDraft,

  generateContent,

  generateDraftImage,

  getDraftImage,

  getDrafts,

  rejectDraft,

  updateDraft,

  type Draft,
  type ImageRevision,
  createImageRevision,
  getImageRevisions,
  acceptImageRevision,
  rejectImageRevision,

} from './services/draftsApi';

import Sidebar, { type Section } from './components/Sidebar';

import { getBusinesses, type Business } from './services/businessesApi';

import BusinessForm from './components/BusinessForm';

import type { Session } from '@supabase/supabase-js';

import { supabase } from './services/supabaseClient';

import AuthPage from './components/AuthPage';

import { ChevronDown, LogOut } from 'lucide-react';

import {

  DropdownMenu,

  DropdownMenuContent,

  DropdownMenuItem,

  DropdownMenuLabel,

  DropdownMenuSeparator,

  DropdownMenuTrigger,

} from '@/components/ui/dropdown-menu';

function formatDraftDate(value: string): string {

  if (!value) return 'Fecha no disponible';

  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)

    ? value

    : `${value}Z`;

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {

    return 'Fecha no disponible';

  }

  return new Intl.DateTimeFormat('es', {

    dateStyle: 'medium',

    timeStyle: 'short',

  }).format(date);

}

const SummaryCard: FC<{

  icon: string;

  label: string;

  value: string;

  detail: string;

  tone: string;

}> = ({ icon, label, value, detail, tone }) => (

  <article className="summary-card">

    <div className={`summary-icon ${tone}`}>{icon}</div>

    <div>

      <span className="summary-label">{label}</span>

      <strong>{value}</strong>

      <small>{detail}</small>

    </div>

  </article>

);

const App: FC = () => {

  const [session, setSession] = useState<Session | null>(null);

  const [checkingAuth, setCheckingAuth] = useState(true);

  const [activeSection, setActiveSection] = useState<Section>('Resumen');

  const [approvals, setApprovals] = useState<Draft[]>([]);

  const [generating, setGenerating] = useState(false);

  const [generationError, setGenerationError] = useState<string | null>(null);

  const [loadingDrafts, setLoadingDrafts] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);

  const [approvalError, setApprovalError] = useState<string | null>(null);

  const [approvingIds, setApprovingIds] = useState<string[]>([]);

  const [busyDraftIds, setBusyDraftIds] = useState<string[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);

  const [editTitle, setEditTitle] = useState('');

  const [editCaption, setEditCaption] = useState('');

  const [businesses, setBusinesses] = useState<Business[]>([]);

  const [selectedBusinessId, setSelectedBusinessId] = useState('');

  const [businessError, setBusinessError] = useState<string | null>(null);

  const [showBusinessForm, setShowBusinessForm] = useState(false);

  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  const [imageBusyIds, setImageBusyIds] = useState<string[]>([]);

  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});

  const [imageInstructions, setImageInstructions] = useState<Record<string, string>>({});
  const [showImageEditor, setShowImageEditor] = useState<Record<string, boolean>>({});
  const [revisions, setRevisions] = useState<Record<string, ImageRevision | null>>({});
  const [revisionBusyIds, setRevisionBusyIds] = useState<string[]>([]);
  const [revisionErrors, setRevisionErrors] = useState<Record<string, string>>({});

  const imageLocks = useRef(new Set<string>());

  const selectedBusinessRef = useRef(selectedBusinessId);

  selectedBusinessRef.current = selectedBusinessId;

  const updateImageInstructions = (draftId: string, value: string) => {

    setImageInstructions((current) => ({

      ...current,

      [draftId]: value,

    }));

  };

  const toggleImageEditor = (draftId: string) => {
    if (!showImageEditor[draftId]) void refreshRevision(draftId);

    setShowImageEditor((current) => ({

      ...current,

      [draftId]: !current[draftId],

    }));

  };

  const addImageSuggestion = (draftId: string, suggestion: string) => {

    setImageInstructions((current) => {

      const existing = current[draftId]?.trim() || '';

      return {

        ...current,

        [draftId]: [existing, suggestion]

          .filter(Boolean)

          .join(existing ? '. ' : '')

          .slice(0, 1000),

      };

    });

  };

  useEffect(() => {

    let active = true;

    supabase.auth.getSession()

      .then(({ data: { session } }) => {

        if (active) {

          setSession(session);

          setCheckingAuth(false);

        }

      })

      .catch(() => {

        if (active) setCheckingAuth(false);

      });

    const { data: { subscription } } =

      supabase.auth.onAuthStateChange((_event, nextSession) => {

        if (active) {

          setSession(nextSession);

          setCheckingAuth(false);

        }

      });

    return () => {

      active = false;

      subscription.unsubscribe();

    };

  }, []);

  useEffect(() => {

    if (!session) return;

    let active = true;

    getBusinesses()

      .then((data) => {

        if (!active) return;

        setBusinesses(data);

        setSelectedBusinessId((current) => current || data[0]?.id || '');

        setBusinessError(null);

      })

      .catch(() => {

        if (active) {

          setBusinessError('No se pudieron cargar los negocios.');

        }

      });

    return () => {

      active = false;

    };

  }, [session?.user.id]);

  useEffect(() => {

    let active = true;

    setApprovals([]);

    setImageUrls({});

    setImageErrors({});

    setImageInstructions({});

    setShowImageEditor({});
    setRevisions({});
    setRevisionErrors({});

    setEditingId(null);

    setApprovalError(null);

    setLoadError(null);

    if (!selectedBusinessId || !session) {

      setLoadingDrafts(false);

      return;

    }

    setLoadingDrafts(true);

    const businessId = selectedBusinessId;

    getDrafts(businessId)

      .then((drafts) => {

        if (active) setApprovals(drafts);

      })

      .catch(() => {

        if (active) {

          setLoadError(

            'No se pudieron cargar los borradores. Comprueba la conexión con el servidor.'

          );

        }

      })

      .finally(() => {

        if (active) setLoadingDrafts(false);

      });

    return () => {

      active = false;

    };

  }, [selectedBusinessId, session?.user.id]);

  const visibleDrafts = useMemo(

    () => approvals.filter(

      (draft) => draft.business_id === selectedBusinessId

    ),

    [approvals, selectedBusinessId]

  );

  const pendingCount = useMemo(

    () => visibleDrafts.filter(

      (draft) => draft.status === 'pending'

    ).length,

    [visibleDrafts]

  );

  const hasAiActivity = !loadingDrafts && !loadError &&

    visibleDrafts.some((draft) => draft.source === 'ai');

  const agents = [

    {

      name: 'Sofía',

      role: 'Estratega de marketing',

      state: loadingDrafts || loadError

        ? 'Sin verificar'

        : hasAiActivity

          ? 'Contenido generado'

          : 'Sin actividad registrada',

      activity: loadingDrafts

        ? 'Consultando actividad...'

        : loadError

          ? 'No se pudo consultar la actividad'

          : hasAiActivity

            ? 'Estrategia utilizada en contenido generado por IA'

            : 'No hay generaciones de IA registradas para este negocio',

    },

    {

      name: 'Leo',

      role: 'Creador de contenido',

      state: loadingDrafts || loadError

        ? 'Sin verificar'

        : hasAiActivity

          ? 'Contenido generado'

          : 'Sin actividad registrada',

      activity: loadingDrafts

        ? 'Consultando actividad...'

        : loadError

          ? 'No se pudo consultar la actividad'

          : hasAiActivity

            ? 'Publicación creada por IA y guardada como borrador'

            : 'No hay generaciones de IA registradas para este negocio',

    },

    {

      name: 'Mía',

      role: 'Analista de marketing',

      state: 'Pendiente',

      activity: 'Esperando conexión de datos de rendimiento',

    },

  ];

  const handleSectionChange = (section: Section) => {

    setActiveSection(section);

    setShowBusinessForm(false);

  };

  const handleBusinessCreated = (business: Business) => {

    setBusinesses((current) => [...current, business]);

    setSelectedBusinessId(business.id);

    setShowBusinessForm(false);

  };

  const updateLocalDraft = (updated: Draft) => {

    setApprovals((current) =>

      current.map((draft) =>

        draft.id === updated.id ? updated : draft

      )

    );

  };

  const handleGenerateContent = async () => {

    if (!selectedBusinessId || generating) return;

    const businessId = selectedBusinessId;

    setGenerating(true);

    setGenerationError(null);

    try {

      const draft = await generateContent(businessId);

      if (selectedBusinessRef.current === businessId) {

        setApprovals((current) => [draft, ...current]);

        setActiveSection('Aprobaciones');

      }

    } catch (error) {

      console.error('Content generation failed:', error);

      if (selectedBusinessRef.current === businessId) {

        setGenerationError(

          'No se pudo generar el contenido. Inténtalo de nuevo.'

        );

      }

    } finally {

      setGenerating(false);

    }

  };

  const handleApprove = async (id: string) => {

    if (

      approvingIds.includes(id) ||

      busyDraftIds.includes(id) ||

      imageLocks.current.has(id)

    ) return;

    const draft = visibleDrafts.find((item) => item.id === id);

    if (!draft || draft.status !== 'pending') return;

    setApprovalError(null);

    setApprovingIds((current) => [...current, id]);

    try {

      const updated = await approveDraft(id);

      updateLocalDraft(updated);

    } catch {

      setApprovalError(

        'No se pudo aprobar el borrador. Inténtalo de nuevo.'

      );

    } finally {

      setApprovingIds((current) =>

        current.filter((value) => value !== id)

      );

    }

  };

  const startEditing = (draft: Draft) => {

    setApprovalError(null);

    setEditingId(draft.id);

    setEditTitle(draft.title);

    setEditCaption(draft.caption);

    setActiveSection('Aprobaciones');

  };

  const handleSaveEdit = async (id: string) => {

    if (!editTitle.trim() || !editCaption.trim()) {

      setApprovalError('El título y el texto no pueden estar vacíos.');

      return;

    }

    if (busyDraftIds.includes(id) || approvingIds.includes(id)) return;

    setBusyDraftIds((current) => [...current, id]);

    setApprovalError(null);

    try {

      const updated = await updateDraft(id, {

        title: editTitle.trim(),

        caption: editCaption.trim(),

      });

      updateLocalDraft(updated);

      setEditingId(null);

    } catch {

      setApprovalError(

        'No se pudo guardar el borrador. Inténtalo de nuevo.'

      );

    } finally {

      setBusyDraftIds((current) =>

        current.filter((value) => value !== id)

      );

    }

  };

  const handleReject = async (id: string) => {

    if (

      busyDraftIds.includes(id) ||

      approvingIds.includes(id) ||

      imageLocks.current.has(id)

    ) return;

    if (!window.confirm(

      '¿Rechazar esta publicación? Se conservará en el historial.'

    )) return;

    setBusyDraftIds((current) => [...current, id]);

    setApprovalError(null);

    try {

      const rejected = await rejectDraft(id);

      updateLocalDraft(rejected);

      if (editingId === id) setEditingId(null);

    } catch {

      setApprovalError(

        'No se pudo rechazar el borrador. Inténtalo de nuevo.'

      );

    } finally {

      setBusyDraftIds((current) =>

        current.filter((value) => value !== id)

      );

    }

  };

  const handleGenerateImage = async (draft: Draft) => {

    if (

      imageLocks.current.has(draft.id) ||

      draft.status !== 'pending' ||

      !draft.image_prompt ||

      draft.image_url ||

      !['not_started', 'failed'].includes(draft.image_status)

    ) return;

    if (!window.confirm(

      '¿Generar una imagen con IA? Esta operación puede generar un cargo en la API de OpenAI.'

    )) return;

    const businessId = draft.business_id;

    imageLocks.current.add(draft.id);

    setImageBusyIds((current) => [...current, draft.id]);

    setImageErrors((current) => {

      const next = { ...current };

      delete next[draft.id];

      return next;

    });

    setApprovals((current) =>

      current.map((item) =>

        item.id === draft.id

          ? { ...item, image_status: 'generating' }

          : item

      )

    );

    try {

      const result = await generateDraftImage(draft.id);

      if (selectedBusinessRef.current === businessId) {

        setImageUrls((current) => ({

          ...current,

          [draft.id]: result.image_url,

        }));

        // Reload the authoritative image status and storage path.

        const refreshedDrafts = await getDrafts(businessId);

        if (selectedBusinessRef.current === businessId) {

          setApprovals(refreshedDrafts);

        }

      }

    } catch (error) {

      console.error('Image generation failed:', error);

      if (selectedBusinessRef.current === businessId) {

        try {

          const refreshedDrafts = await getDrafts(businessId);

          if (selectedBusinessRef.current === businessId) {

            setApprovals(refreshedDrafts);

          }

        } catch {

          // The request may have completed despite a network error.

        }

        if (selectedBusinessRef.current === businessId) {

          setImageErrors((current) => ({

            ...current,

            [draft.id]:

              'No se pudo confirmar la generación. Actualiza la página antes de intentar nuevamente.',

          }));

        }

      }

    } finally {

      imageLocks.current.delete(draft.id);

      setImageBusyIds((current) =>

        current.filter((value) => value !== draft.id)

      );

    }

  };

  const handlePreviewImage = async (draft: Draft) => {

    if (imageLocks.current.has(draft.id)) return;

    const businessId = draft.business_id;

    imageLocks.current.add(draft.id);

    setImageBusyIds((current) => [...current, draft.id]);

    setImageErrors((current) => {

      const next = { ...current };

      delete next[draft.id];

      return next;

    });

    try {

      const result = await getDraftImage(draft.id);

      if (selectedBusinessRef.current === businessId) {

        setImageUrls((current) => ({

          ...current,

          [draft.id]: result.image_url,

        }));

      }

    } catch (error) {

      console.error('Image preview failed:', error);

      if (selectedBusinessRef.current === businessId) {

        setImageErrors((current) => ({

          ...current,

          [draft.id]:

            'No se pudo cargar la imagen. Inténtalo nuevamente.',

        }));

      }

    } finally {

      imageLocks.current.delete(draft.id);

      setImageBusyIds((current) =>

        current.filter((value) => value !== draft.id)

      );

    }

  };

  const refreshRevision = async (draftId: string) => {
    const businessId = selectedBusinessRef.current;
    try {
      const history = await getImageRevisions(draftId);
      if (selectedBusinessRef.current !== businessId) return;
      setRevisions((current) => ({
        ...current,
        [draftId]: history.find((r) => r.status === 'ready' || r.status === 'generating') ?? null,
      }));
      setRevisionErrors((current) => ({ ...current, [draftId]: '' }));
    } catch (error) {
      console.error('Could not load revisions', error);
      if (selectedBusinessRef.current === businessId) {
        setRevisionErrors((current) => ({ ...current, [draftId]: 'No se pudo consultar el estado de la edición.' }));
      }
    }
  };

  const handleCreateRevision = async (draft: Draft) => {
    const instructions = imageInstructions[draft.id]?.trim() ?? '';
    if (!instructions || instructions.length > 1000 || imageLocks.current.has(draft.id)) return;
    if (revisions[draft.id]?.status === 'ready' || revisions[draft.id]?.status === 'generating') return;
    if (!window.confirm('¿Crear una nueva imagen con IA? Esta solicitud puede generar un cargo adicional en OpenAI. La original se conservará.')) return;
    const businessId = draft.business_id;
    imageLocks.current.add(draft.id);
    setRevisionBusyIds((ids) => [...ids, draft.id]);
    setRevisionErrors((current) => ({ ...current, [draft.id]: '' }));
    try {
      const result = await createImageRevision(draft.id, instructions);
      if (selectedBusinessRef.current === businessId) {
        setRevisions((current) => ({ ...current, [draft.id]: result }));
      }
    } catch (error) {
      console.error('Revision request failed', error);
      if (selectedBusinessRef.current === businessId) {
        await refreshRevision(draft.id);
        setRevisionErrors((current) => ({ ...current, [draft.id]: 'No se pudo confirmar la generación. Consulta el estado antes de volver a intentarlo para evitar cargos duplicados.' }));
      }
    } finally {
      imageLocks.current.delete(draft.id);
      setRevisionBusyIds((ids) => ids.filter((id) => id !== draft.id));
    }
  };

  const handleDecideRevision = async (draft: Draft, decision: 'accept' | 'reject') => {
    const revision = revisions[draft.id];
    if (!revision || revision.status !== 'ready' || imageLocks.current.has(draft.id)) return;
    if (decision === 'accept' && !window.confirm('¿Usar la nueva versión para esta publicación?')) return;
    const businessId = draft.business_id;
    imageLocks.current.add(draft.id);
    setRevisionBusyIds((ids) => [...ids, draft.id]);
    setRevisionErrors((current) => ({ ...current, [draft.id]: '' }));
    try {
      if (decision === 'accept') {
        await acceptImageRevision(draft.id, revision.id);
        if (businessId) {
          const [freshDrafts, freshImage] = await Promise.all([
            getDrafts(businessId),
            getDraftImage(draft.id),
          ]);
          if (selectedBusinessRef.current === businessId) {
            setApprovals(freshDrafts);
            setImageUrls((current) => ({ ...current, [draft.id]: freshImage.image_url }));
          }
        }
      } else {
        await rejectImageRevision(draft.id, revision.id);
      }
      if (selectedBusinessRef.current === businessId) {
        setRevisions((current) => ({ ...current, [draft.id]: null }));
        setImageInstructions((current) => ({ ...current, [draft.id]: '' }));
      }
    } catch (error) {
      console.error('Revision decision failed', error);
      if (selectedBusinessRef.current === businessId) {
        setRevisionErrors((current) => ({ ...current, [draft.id]: 'No se pudo confirmar el cambio. Actualiza la página y comprueba el resultado.' }));
      }
    } finally {
      imageLocks.current.delete(draft.id);
      setRevisionBusyIds((ids) => ids.filter((id) => id !== draft.id));
    }
  };

  const draftMessages = (

    <>

      {loadingDrafts && (

        <p className="empty-state" role="status">

          Cargando borradores...

        </p>

      )}

      {loadError && (

        <p className="empty-state" role="alert">{loadError}</p>

      )}

      {approvalError && (

        <p className="empty-state" role="alert">{approvalError}</p>

      )}

    </>

  );

  if (checkingAuth) {

    return <div className="auth-loading">Cargando...</div>;

  }

  if (!session) {

    return <AuthPage />;

  }

  return (

    <div className="app-shell">

      <Sidebar

        activeSection={activeSection}

        onSectionChange={handleSectionChange}

        pendingCount={pendingCount}

      />

      <main className="main-content">

        <header className="topbar">

          <div className="topbar-heading">

            <span className="eyebrow">Estudio de marketing</span>

            <h1>{activeSection}</h1>

          </div>

          <div className="topbar-actions">

            <select

              aria-label="Seleccionar negocio"

              value={selectedBusinessId}

              onChange={(event) => setSelectedBusinessId(event.target.value)}

              disabled={businesses.length === 0}

            >

              {businesses.length === 0 && (

                <option value="">Sin negocios</option>

              )}

              {businesses.map((business) => (

                <option key={business.id} value={business.id}>

                  {business.name}

                </option>

              ))}

            </select>

            <button

              type="button"

              className="primary-button add-business-button"

              onClick={() => setShowBusinessForm(true)}

            >

              + Agregar negocio

            </button>

            <div className="topbar-account">

              <DropdownMenu>

                <DropdownMenuTrigger asChild>

                  <button

                    type="button"

                    className="account-trigger"

                    aria-label="Abrir menú de Ángela"

                  >

                    <span className="avatar small">Á</span>

                    <span className="account-name">Ángela</span>

                    <ChevronDown size={16} aria-hidden="true" />

                  </button>

                </DropdownMenuTrigger>

                <DropdownMenuContent align="end" className="w-52">

                  <DropdownMenuLabel>

                    <div className="flex flex-col gap-1">

                      <span>Ángela</span>

                      <span className="text-xs font-normal text-muted-foreground">

                        Administradora

                      </span>

                    </div>

                  </DropdownMenuLabel>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem

                    onSelect={() => void supabase.auth.signOut()}

                    className="cursor-pointer"

                  >

                    <LogOut className="mr-2 size-4" />

                    Cerrar sesión

                  </DropdownMenuItem>

                </DropdownMenuContent>

              </DropdownMenu>

            </div>

            {businessError && (

              <span className="topbar-error" role="alert">

                {businessError}

              </span>

            )}

          </div>

        </header>

        {showBusinessForm ? (

          <BusinessForm

            onCreated={handleBusinessCreated}

            onCancel={() => setShowBusinessForm(false)}

          />

        ) : activeSection === 'Resumen' ? (

          <>

            <section className="welcome">

              <div>

                <h2>Buenos días, Ángela <span>✦</span></h2>

                <p>

                  Aquí tienes una visión general de lo que está

                  pasando en tu marketing.

                </p>

              </div>

              <button

                className="primary-button"

                type="button"

                onClick={() => void handleGenerateContent()}

                disabled={!selectedBusinessId || generating}

              >

                {generating

                  ? 'Generando contenido...'

                  : '＋ Crear contenido'}

              </button>

              {generationError && (

                <p role="alert">{generationError}</p>

              )}

            </section>

            <section

              className="summary-grid"

              aria-label="Resumen de métricas"

            >

              <SummaryCard

                icon="◈"

                label="Campañas activas"

                value="0"

                detail="Aún no hay campañas"

                tone="purple"

              />

              <SummaryCard

                icon="✧"

                label="Contenido generado"

                value={

                  loadingDrafts || loadError

                    ? '—'

                    : String(visibleDrafts.length)

                }

                detail="Borradores registrados"

                tone="orange"

              />

              <SummaryCard

                icon="✓"

                label="Aprobaciones pendientes"

                value={

                  loadingDrafts || loadError

                    ? '—'

                    : String(pendingCount)

                }

                detail="Requieren tu atención"

                tone="blue"

              />

              <SummaryCard

                icon="◒"

                label="Alcance estimado"

                value="—"

                detail="Disponible al conectar redes sociales"

                tone="green"

              />

            </section>

            <section className="dashboard-grid">

              <article className="panel campaigns-panel">

                <div className="panel-heading">

                  <div>

                    <span className="eyebrow">Rendimiento</span>

                    <h2>Resumen de campañas</h2>

                  </div>

                  <button

                    className="text-button"

                    type="button"

                    onClick={() => setActiveSection('Campañas')}

                  >

                    Ver todas →

                  </button>

                </div>

                <div className="campaign-list">

                  <div style={{ padding: '2rem', textAlign: 'center' }}>

                    <p style={{ fontWeight: 600 }}>

                      Aún no hay campañas

                    </p>

                    <p style={{ color: '#64748b', marginTop: '0.5rem' }}>

                      Cuando el equipo IA cree campañas para este negocio,

                      aparecerán aquí.

                    </p>

                  </div>

                </div>

              </article>

              <article className="panel activity-panel">

                <div className="panel-heading">

                  <div>

                    <span className="eyebrow">Automatización</span>

                    <h2>Actividad del Equipo IA</h2>

                  </div>

                  <button

                    className="text-button"

                    type="button"

                    onClick={() => setActiveSection('Equipo IA')}

                  >

                    Ver equipo →

                  </button>

                </div>

                <div className="agent-list">

                  {agents.map((agent) => (

                    <div className="agent-row" key={agent.name}>

                      <div className="agent-avatar">

                        {agent.name[0]}

                      </div>

                      <div className="agent-info">

                        <strong>{agent.name}</strong>

                        <span>{agent.role}</span>

                      </div>

                      <div className="agent-status">

                        <span

                          className={`status-dot ${

                            agent.state === 'Contenido generado'

                              ? 'available'

                              : ''

                          }`}

                        />

                        {agent.state}

                        <small>{agent.activity}</small>

                      </div>

                    </div>

                  ))}

                </div>

              </article>

            </section>

            <section className="bottom-grid">

              <article className="panel">

                <div className="panel-heading">

                  <div>

                    <span className="eyebrow">Contenido reciente</span>

                    <h2>Publicaciones sociales</h2>

                  </div>

                  <button

                    className="text-button"

                    type="button"

                    onClick={() => setActiveSection('Contenido')}

                  >

                    Ver contenido →

                  </button>

                </div>

                <div className="post-list">

                  <div style={{ padding: '2rem', textAlign: 'center' }}>

                    <p style={{ fontWeight: 600 }}>

                      Aún no hay publicaciones

                    </p>

                    <p style={{ color: '#64748b', marginTop: '0.5rem' }}>

                      Las publicaciones aparecerán aquí cuando sean

                      creadas y publicadas en las redes sociales.

                    </p>

                  </div>

                </div>

              </article>

              <article className="panel approval-panel">

                <div className="panel-heading">

                  <div>

                    <span className="eyebrow">Tu bandeja</span>

                    <h2>Aprobaciones pendientes</h2>

                  </div>

                  <button

                    className="text-button"

                    type="button"

                    onClick={() => setActiveSection('Aprobaciones')}

                  >

                    Ver todas →

                  </button>

                </div>

                <div className="approval-list">

                  {draftMessages}

                  {!loadingDrafts && !loadError &&

                    visibleDrafts

                      .filter((draft) => draft.status === 'pending')

                      .slice(0, 2)

                      .map((draft) => (

                        <div className="approval-row" key={draft.id}>

                          <div className="approval-content">

                            <strong>{draft.title}</strong>

                            <span>

                              {draft.platform} ·{' '}

                              {formatDraftDate(draft.created_at)}

                            </span>

                            <span>{draft.caption}</span>

                          </div>

                          <div className="approval-actions">

                            <button

                              className="approve-button"

                              type="button"

                              disabled={

                                approvingIds.includes(draft.id) ||

                                busyDraftIds.includes(draft.id) ||

                                imageBusyIds.includes(draft.id) ||

                                editingId === draft.id

                              }

                              onClick={() => void handleApprove(draft.id)}

                            >

                              {approvingIds.includes(draft.id)

                                ? 'Aprobando...'

                                : 'Aprobar'}

                            </button>

                            <button

                              className="text-button"

                              type="button"

                              disabled={

                                busyDraftIds.includes(draft.id) ||

                                approvingIds.includes(draft.id)

                              }

                              onClick={() => startEditing(draft)}

                            >

                              Editar

                            </button>

                            <button

                              className="reject-button"

                              type="button"

                              disabled={

                                busyDraftIds.includes(draft.id) ||

                                approvingIds.includes(draft.id) ||

                                imageBusyIds.includes(draft.id)

                              }

                              onClick={() => void handleReject(draft.id)}

                            >

                              Rechazar

                            </button>

                          </div>

                        </div>

                      ))}

                  {!loadingDrafts && !loadError && pendingCount === 0 && (

                    <p className="empty-state">

                      Todo está al día. No hay aprobaciones pendientes.

                    </p>

                  )}

                </div>

              </article>

            </section>

          </>

        ) : activeSection === 'Aprobaciones' ? (

          <section className="panel approval-page">

            <div className="panel-heading">

              <div>

                <span className="eyebrow">Revisión de contenido</span>

                <h2>Cola de aprobaciones</h2>

              </div>

              <span className="approval-counter">

                {loadingDrafts || loadError ? '—' : pendingCount} pendientes

              </span>

            </div>

            <div className="approval-page-list">

              {draftMessages}

              {!loadingDrafts && !loadError &&

                visibleDrafts.map((draft) => (

                  <div className="approval-card" key={draft.id}>

                    <div className="approval-card-top">

                      <span className="channel-tag">

                        {draft.platform}

                      </span>

                      <time>

                        {formatDraftDate(draft.created_at)}

                      </time>

                    </div>

                    {editingId === draft.id ? (

                      <div

                        className="draft-edit-form"

                        style={{

                          display: 'grid',

                          gap: '0.75rem',

                          marginTop: '1rem',

                        }}

                      >

                        <label htmlFor={`edit-title-${draft.id}`}>

                          Título

                        </label>

                        <input

                          id={`edit-title-${draft.id}`}

                          value={editTitle}

                          onChange={(event) =>

                            setEditTitle(event.target.value)

                          }

                          maxLength={200}

                          style={{

                            width: '100%',

                            padding: '0.6rem',

                          }}

                        />

                        <label htmlFor={`edit-caption-${draft.id}`}>

                          Texto de la publicación

                        </label>

                        <textarea

                          id={`edit-caption-${draft.id}`}

                          value={editCaption}

                          onChange={(event) =>

                            setEditCaption(event.target.value)

                          }

                          rows={6}

                          style={{

                            width: '100%',

                            padding: '0.6rem',

                          }}

                        />

                        <div className="approval-actions">

                          <button

                            className="approve-button"

                            type="button"

                            disabled={

                              busyDraftIds.includes(draft.id) ||

                              !editTitle.trim() ||

                              !editCaption.trim()

                            }

                            onClick={() =>

                              void handleSaveEdit(draft.id)

                            }

                          >

                            {busyDraftIds.includes(draft.id)

                              ? 'Guardando...'

                              : 'Guardar cambios'}

                          </button>

                          <button

                            className="text-button"

                            type="button"

                            disabled={busyDraftIds.includes(draft.id)}

                            onClick={() => setEditingId(null)}

                          >

                            Cancelar

                          </button>

                        </div>

                      </div>

                    ) : (

                      <>

                        <h3>{draft.title}</h3>

                        <p>{draft.caption}</p>

                      </>

                    )}

                    <div

                      className="draft-image-section"

                      style={{

                        marginTop: '1.25rem',

                        marginBottom: '1.25rem',

                        display: 'grid',

                        gap: '0.75rem',

                      }}

                    >

                      <strong>Imagen de la publicación</strong>

                      {imageUrls[draft.id] && (

                        <img

                          src={imageUrls[draft.id]}

                          alt={`Imagen para ${draft.title}`}

                          style={{

                            width: '100%',

                            maxWidth: '420px',

                            borderRadius: '12px',

                            objectFit: 'contain',

                          }}

                        />

                      )}

                      {draft.image_status === 'generating' && (

                        <p role="status">

                          La imagen se está generando. Esto puede tardar

                          unos minutos.

                        </p>

                      )}

                      {draft.image_status === 'failed' && (

                        <p role="status">

                          La generación anterior no se completó.

                        </p>

                      )}

                      {draft.image_status === 'completed' &&

                        !imageUrls[draft.id] && (

                          <p>

                            La imagen está guardada y lista para visualizar.

                          </p>

                        )}

                      {imageErrors[draft.id] && (

                        <p

                          role="alert"

                          style={{ color: '#b91c1c' }}

                        >

                          {imageErrors[draft.id]}

                        </p>

                      )}

                      <div className="approval-actions">

                        {draft.status === 'pending' &&

                          !!draft.image_prompt &&

                          !draft.image_url &&

                          ['not_started', 'failed'].includes(

                            draft.image_status

                          ) && (

                            <button

                              className="primary-button"

                              type="button"

                              disabled={

                                imageBusyIds.includes(draft.id) ||

                                busyDraftIds.includes(draft.id) ||

                                approvingIds.includes(draft.id)

                              }

                              onClick={() =>

                                void handleGenerateImage(draft)

                              }

                            >

                              {imageBusyIds.includes(draft.id)

                                ? 'Generando imagen...'

                                : draft.image_status === 'failed'

                                  ? 'Reintentar imagen'

                                  : '✦ Generar imagen'}

                            </button>

                          )}

                        {draft.image_status === 'completed' &&

                          !!draft.image_url && (

                            <button

                              className="text-button"

                              type="button"

                              disabled={imageBusyIds.includes(draft.id)}

                              onClick={() =>

                                void handlePreviewImage(draft)

                              }

                            >

                              {imageBusyIds.includes(draft.id)

                                ? 'Cargando imagen...'

                                : imageUrls[draft.id]

                                  ? 'Actualizar vista previa'

                                  : 'Ver imagen'}

                            </button>

                          )}

                      </div>

                      {!draft.image_prompt && !draft.image_url && (

                        <small>

                          Este borrador no tiene una descripción de imagen

                          generada por IA.

                        </small>

                      )}

                    </div>

                    {draft.status === 'pending' &&

                    editingId !== draft.id ? (

                      <div className="approval-actions">

                        <button

                          className="approve-button"

                          type="button"

                          disabled={

                            approvingIds.includes(draft.id) ||

                            busyDraftIds.includes(draft.id) ||

                            imageBusyIds.includes(draft.id)

                          }

                          onClick={() =>

                            void handleApprove(draft.id)

                          }

                        >

                          {approvingIds.includes(draft.id)

                            ? 'Aprobando...'

                            : '✓ Aprobar'}

                        </button>

                        <button

                          className="text-button"

                          type="button"

                          disabled={

                            busyDraftIds.includes(draft.id) ||

                            approvingIds.includes(draft.id)

                          }

                          onClick={() => startEditing(draft)}

                        >

                          Editar

                        </button>

                        <button

                          className="reject-button"

                          type="button"

                          disabled={

                            busyDraftIds.includes(draft.id) ||

                            approvingIds.includes(draft.id) ||

                            imageBusyIds.includes(draft.id)

                          }

                          onClick={() =>

                            void handleReject(draft.id)

                          }

                        >

                          {busyDraftIds.includes(draft.id)

                            ? 'Procesando...'

                            : 'Rechazar'}

                        </button>

                      </div>

                    ) : draft.status !== 'pending' ? (

                      <span

                        className={`final-status ${

                          draft.status === 'approved'

                            ? 'aprobado'

                            : ''

                        }`}

                      >

                        {draft.status === 'approved'

                          ? '✓ Aprobado'

                          : draft.status === 'rejected'

                            ? '✕ Rechazado'

                            : draft.status}

                      </span>

                    ) : null}

                    {/* Spanish AI image editor */}
                    {draft.status === 'pending' && draft.image_status === 'completed' && !!draft.image_url && (
                      <div className="ai-image-editor">
                        <button type="button" className="ai-editor-toggle"
                          onClick={() => toggleImageEditor(draft.id)}
                          aria-expanded={!!showImageEditor[draft.id]}
                          aria-controls={`ai-editor-content-${draft.id}`}>
                          <span>✦ Editar imagen con IA</span>
                          <span aria-hidden="true">{showImageEditor[draft.id] ? '−' : '+'}</span>
                        </button>
                        {showImageEditor[draft.id] && (
                          <div id={`ai-editor-content-${draft.id}`} className="ai-editor-content">
                            <p>Describe en español los cambios. La imagen original se conservará hasta que aceptes una versión nueva.</p>
                            {revisionErrors[draft.id] && <p role="alert" style={{ color: '#b91c1c' }}>{revisionErrors[draft.id]}</p>}
                            {revisions[draft.id]?.status === 'ready' ? (
                              <>
                                <p><strong>Versión nueva lista para revisar</strong></p>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                                  <div>
                                    <strong>Original</strong>
                                    {imageUrls[draft.id] ? <img src={imageUrls[draft.id]} alt="Imagen original" style={{ width: '100%', borderRadius: 12 }} /> : <button type="button" onClick={() => void handlePreviewImage(draft)}>Ver original</button>}
                                  </div>
                                  <div>
                                    <strong>Nueva versión</strong>
                                    {revisions[draft.id]?.image_url ? <img src={revisions[draft.id]!.image_url!} alt="Versión editada" style={{ width: '100%', borderRadius: 12 }} /> : <p>No se recibió una vista previa. Actualiza el estado.</p>}
                                  </div>
                                </div>
                                <div className="approval-actions">
                                  <button type="button" className="approve-button" disabled={revisionBusyIds.includes(draft.id)} onClick={() => void handleDecideRevision(draft, 'accept')}>✓ Aceptar nueva versión</button>
                                  <button type="button" className="reject-button" disabled={revisionBusyIds.includes(draft.id)} onClick={() => void handleDecideRevision(draft, 'reject')}>Conservar original</button>
                                </div>
                              </>
                            ) : revisions[draft.id]?.status === 'generating' ? (
                              <p role="status">La nueva imagen se está generando. No solicites otra hasta confirmar el resultado.</p>
                            ) : (
                              <>
                                <label htmlFor={`image-instructions-${draft.id}`}>Instrucciones para la IA</label>
                                <textarea id={`image-instructions-${draft.id}`}
                                  value={imageInstructions[draft.id] || ''}
                                  onChange={(event) => updateImageInstructions(draft.id, event.target.value)}
                                  placeholder="Ejemplo: Mejora la iluminación y cambia el fondo por una mesa elegante."
                                  rows={4} maxLength={1000} disabled={revisionBusyIds.includes(draft.id)} />
                                <div className="ai-editor-suggestions">
                                  {['Mejorar iluminación', 'Cambiar el fondo', 'Estilo más profesional'].map((suggestion) => (
                                    <button key={suggestion} type="button" disabled={revisionBusyIds.includes(draft.id)} onClick={() => addImageSuggestion(draft.id, suggestion)}>+ {suggestion}</button>
                                  ))}
                                </div>
                                <button type="button" className="primary-button ai-regenerate-button"
                                  disabled={revisionBusyIds.includes(draft.id) || !imageInstructions[draft.id]?.trim()}
                                  onClick={() => void handleCreateRevision(draft)}>
                                  {revisionBusyIds.includes(draft.id) ? 'Generando nueva versión...' : '✦ Generar nueva versión'}
                                </button>
                                <small>La generación con IA puede tener un costo adicional. Se solicitará confirmación antes de continuar.</small>
                              </>
                            )}
                            <button type="button" className="text-button" disabled={revisionBusyIds.includes(draft.id)} onClick={() => void refreshRevision(draft.id)}>Actualizar estado</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                ))}

              {!loadingDrafts &&

                !loadError &&

                visibleDrafts.length === 0 && (

                  <p className="empty-state">

                    Todavía no hay borradores para revisar.

                  </p>

                )}

            </div>

          </section>

        ) : activeSection === 'Equipo IA' ? (

          <section className="panel activity-panel">

            <div className="panel-heading">

              <div>

                <span className="eyebrow">Automatización</span>

                <h2>Actividad del Equipo IA</h2>

              </div>

            </div>

            <div className="agent-list">

              {agents.map((agent) => (

                <div className="agent-row" key={agent.name}>

                  <div className="agent-avatar">

                    {agent.name[0]}

                  </div>

                  <div className="agent-info">

                    <strong>{agent.name}</strong>

                    <span>{agent.role}</span>

                  </div>

                  <div className="agent-status">

                    <span

                      className={`status-dot ${

                        agent.state === 'Contenido generado'

                          ? 'available'

                          : ''

                      }`}

                    />

                    {agent.state}

                    <small>{agent.activity}</small>

                  </div>

                </div>

              ))}

            </div>

          </section>

        ) : (

          <section className="panel placeholder-panel">

            <div className="placeholder-icon">✦</div>

            <h2>{activeSection}</h2>

            <p>

              Esta sección está lista para que empieces a trabajar.

              Selecciona otra opción para volver al resumen.

            </p>

            <button

              className="primary-button"

              type="button"

              onClick={() => setActiveSection('Resumen')}

            >

              Volver al resumen

            </button>

          </section>

        )}

      </main>

    </div>

  );

};

export default App;
