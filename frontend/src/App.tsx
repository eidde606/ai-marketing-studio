import { useMemo, useState, type FC } from 'react';
import Sidebar, { type Section } from './components/Sidebar';

type ApprovalStatus = 'pendiente' | 'aprobado' | 'rechazado';

type Approval = {
  id: number;
  title: string;
  preview: string;
  author: string;
  channel: string;
  date: string;
  status: ApprovalStatus;
};

const campaigns = [
  { name: 'Lanzamiento primavera', status: 'Activa', progress: 78, channel: 'Instagram · Email', date: '12 mar 2025' },
  { name: 'Historias de clientes', status: 'En borrador', progress: 35, channel: 'LinkedIn', date: '18 mar 2025' },
  { name: 'Oferta de bienvenida', status: 'Finalizada', progress: 100, channel: 'Web · Meta', date: '04 mar 2025' },
];

const agents = [
  { name: 'Sofía', role: 'Estratega de contenido', state: 'Trabajando', activity: 'Preparó 4 nuevas ideas de campaña' },
  { name: 'Leo', role: 'Redactor social', state: 'Disponible', activity: 'Última actividad hace 12 min' },
  { name: 'Mía', role: 'Analista de rendimiento', state: 'Analizando', activity: 'Actualizó el informe semanal' },
];

const posts = [
  { platform: 'Instagram', text: 'Descubre una forma más sencilla de hacer crecer tu marca...', state: 'Programada', time: 'Hoy, 18:00' },
  { platform: 'LinkedIn', text: 'Cinco aprendizajes que cambiaron nuestra estrategia...', state: 'Publicada', time: 'Ayer, 10:30' },
];

const initialApprovals: Approval[] = [
  {
    id: 1,
    title: 'Carrusel: 3 ideas para tu próxima campaña',
    preview: 'Convierte tus mejores ideas en resultados medibles con una estrategia clara.',
    author: 'Sofía · Estratega IA',
    channel: 'Instagram',
    date: 'Hoy, 09:15',
    status: 'pendiente',
  },
  {
    id: 2,
    title: 'Publicación: caso de éxito Acme',
    preview: 'Acme aumentó su alcance un 42% en solo cuatro semanas.',
    author: 'Leo · Redactor IA',
    channel: 'LinkedIn',
    date: 'Ayer, 16:40',
    status: 'pendiente',
  },
  {
    id: 3,
    title: 'Email: novedades de marzo',
    preview: 'Conoce las novedades que hemos preparado para ayudarte a avanzar.',
    author: 'Mía · Marketing IA',
    channel: 'Email',
    date: 'Ayer, 11:20',
    status: 'pendiente',
  },
];

const SummaryCard: FC<{ icon: string; label: string; value: string; detail: string; tone: string }> = ({
  icon,
  label,
  value,
  detail,
  tone,
}) => (
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
  const [activeSection, setActiveSection] = useState<Section>('Resumen');
  const [approvals, setApprovals] = useState<Approval[]>(initialApprovals);

  const pendingCount = useMemo(
    () => approvals.filter((approval) => approval.status === 'pendiente').length,
    [approvals],
  );

  const updateApproval = (id: number, status: ApprovalStatus) => {
    setApprovals((current) =>
      current.map((approval) => (approval.id === id ? { ...approval, status } : approval)),
    );
  };

  return (
    <div className="app-shell">
      <Sidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        pendingCount={pendingCount}
      />

      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">Estudio de marketing</span>
            <h1>{activeSection}</h1>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" type="button" aria-label="Notificaciones">♧</button>
            <button className="profile-button" type="button">
              <span className="avatar small">AM</span>
              <span>Alex</span>
              <span>⌄</span>
            </button>
          </div>
        </header>

        {activeSection === 'Resumen' ? (
          <>
            <section className="welcome">
              <div>
                <h2>Buenos días, Alex <span>✦</span></h2>
                <p>Aquí tienes una visión general de lo que está pasando en tu marketing.</p>
              </div>
              <button className="primary-button" type="button">＋ Crear contenido</button>
            </section>

            <section className="summary-grid" aria-label="Resumen de métricas">
              <SummaryCard icon="◈" label="Campañas activas" value="8" detail="+2 esta semana" tone="purple" />
              <SummaryCard icon="✧" label="Contenido generado" value="124" detail="+18% vs. mes anterior" tone="orange" />
              <SummaryCard icon="✓" label="Aprobaciones pendientes" value={String(pendingCount)} detail="Requieren tu atención" tone="blue" />
              <SummaryCard icon="◒" label="Alcance estimado" value="248K" detail="+24,6% este mes" tone="green" />
            </section>

            <section className="dashboard-grid">
              <article className="panel campaigns-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">Rendimiento</span>
                    <h2>Resumen de campañas</h2>
                  </div>
                  <button className="text-button" type="button" onClick={() => setActiveSection('Campañas')}>Ver todas →</button>
                </div>
                <div className="campaign-list">
                  {campaigns.map((campaign) => (
                    <div className="campaign-row" key={campaign.name}>
                      <div className="campaign-main">
                        <div className={`campaign-dot ${campaign.status.toLowerCase().replace(' ', '-')}`} />
                        <div>
                          <strong>{campaign.name}</strong>
                          <span>{campaign.channel}</span>
                        </div>
                      </div>
                      <div className="progress-wrap">
                        <div className="progress-label"><span>{campaign.status}</span><b>{campaign.progress}%</b></div>
                        <div className="progress-track"><div style={{ width: `${campaign.progress}%` }} /></div>
                      </div>
                      <time>{campaign.date}</time>
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel activity-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">Automatización</span>
                    <h2>Actividad del Equipo IA</h2>
                  </div>
                  <button className="text-button" type="button" onClick={() => setActiveSection('Equipo IA')}>Ver equipo →</button>
                </div>
                <div className="agent-list">
                  {agents.map((agent) => (
                    <div className="agent-row" key={agent.name}>
                      <div className="agent-avatar">{agent.name[0]}</div>
                      <div className="agent-info"><strong>{agent.name}</strong><span>{agent.role}</span></div>
                      <div className="agent-status"><span className={`status-dot ${agent.state === 'Disponible' ? 'available' : ''}`} />{agent.state}<small>{agent.activity}</small></div>
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
                  <button className="text-button" type="button" onClick={() => setActiveSection('Contenido')}>Ver contenido →</button>
                </div>
                <div className="post-list">
                  {posts.map((post) => (
                    <div className="post-row" key={post.text}>
                      <div className={`platform-icon ${post.platform.toLowerCase()}`}>{post.platform === 'Instagram' ? '◎' : 'in'}</div>
                      <div><strong>{post.platform}</strong><span>{post.text}</span></div>
                      <div className="post-meta"><em className={post.state === 'Publicada' ? 'published' : ''}>{post.state}</em><small>{post.time}</small></div>
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel approval-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">Tu bandeja</span>
                    <h2>Aprobaciones pendientes</h2>
                  </div>
                  <button className="text-button" type="button" onClick={() => setActiveSection('Aprobaciones')}>Ver todas →</button>
                </div>
                <div className="approval-list">
                  {approvals.filter((approval) => approval.status === 'pendiente').slice(0, 2).map((approval) => (
                    <div className="approval-row" key={approval.id}>
                      <div className="approval-content"><strong>{approval.title}</strong><span>{approval.author} · {approval.channel}</span></div>
                      <div className="approval-actions">
                        <button className="approve-button" type="button" onClick={() => updateApproval(approval.id, 'aprobado')}>Aprobar</button>
                        <button className="reject-button" type="button" onClick={() => updateApproval(approval.id, 'rechazado')}>Rechazar</button>
                      </div>
                    </div>
                  ))}
                  {pendingCount === 0 && <p className="empty-state">Todo está al día. No hay aprobaciones pendientes.</p>}
                </div>
              </article>
            </section>
          </>
        ) : activeSection === 'Aprobaciones' ? (
          <section className="panel approval-page">
            <div className="panel-heading">
              <div><span className="eyebrow">Revisión de contenido</span><h2>Cola de aprobaciones</h2></div>
              <span className="approval-counter">{pendingCount} pendientes</span>
            </div>
            <div className="approval-page-list">
              {approvals.map((approval) => (
                <div className="approval-card" key={approval.id}>
                  <div className="approval-card-top"><span className="channel-tag">{approval.channel}</span><time>{approval.date}</time></div>
                  <h3>{approval.title}</h3>
                  <p>{approval.preview}</p>
                  <span className="approval-author">{approval.author}</span>
                  {approval.status === 'pendiente' ? (
                    <div className="approval-actions"><button className="approve-button" type="button" onClick={() => updateApproval(approval.id, 'aprobado')}>✓ Aprobar</button><button className="reject-button" type="button" onClick={() => updateApproval(approval.id, 'rechazado')}>× Rechazar</button></div>
                  ) : <span className={`final-status ${approval.status}`}>{approval.status === 'aprobado' ? '✓ Aprobado' : '× Rechazado'}</span>}
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="panel placeholder-panel">
            <div className="placeholder-icon">✦</div>
            <h2>{activeSection}</h2>
            <p>Esta sección está lista para que empieces a trabajar. Selecciona otra opción para volver al resumen.</p>
            <button className="primary-button" type="button" onClick={() => setActiveSection('Resumen')}>Volver al resumen</button>
          </section>
        )}
      </main>
    </div>
  );
};

export default App;
