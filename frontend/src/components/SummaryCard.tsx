
import type { FC } from 'react';

type SummaryCardProps = {
  icon: string;
  label: string;
  value: string;
  detail: string;
  tone: string;
};

const SummaryCard: FC<SummaryCardProps> = ({
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

export default SummaryCard;
  