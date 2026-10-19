import { ArrowUpRight, Building2, MapPin, Phone } from 'lucide-react';
import { type ClinicResult } from '../../../shared/contracts';

export function ClinicCard({
  clinic,
  compact = false,
  showDistance = false,
}: {
  clinic: ClinicResult;
  compact?: boolean;
  showDistance?: boolean;
}) {
  return (
    <article className={`clinic-card ${compact ? 'compact' : ''}`}>
      <div className="clinic-title-row">
        <span className="clinic-icon">
          <Building2 size={20} />
        </span>
        <div>
          <span className={`clinic-badge ${clinic.isDemo ? 'is-demo' : ''}`}>
            {clinic.isDemo
              ? 'CLÍNICA FICTÍCIA'
              : clinic.provenance === 'official-website'
                ? 'FONTE: SITE DA CLÍNICA'
                : clinic.provenance === 'public-directory'
                  ? 'DIRETÓRIO PÚBLICO'
                  : 'CADASTRO COM FONTE'}
          </span>
          <h3>{clinic.name}</h3>
          {clinic.professionalName && (
            <p className="clinic-professional">{clinic.professionalName}</p>
          )}
        </div>
      </div>
      <p className="clinic-location">
        <MapPin size={14} />
        {[clinic.neighborhood, [clinic.city, clinic.state].filter(Boolean).join(', ')]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {clinic.accessNote && <p className="result-note">{clinic.accessNote}</p>}
      <p className="clinic-specialties">{clinic.specialtyDetails.map((s) => s.name).join(' · ')}</p>
      {showDistance && (
        <p className="clinic-distance">
          {clinic.distanceKm === null
            ? 'Distância não disponível'
            : clinic.distanceKm < 1
              ? `${Math.round((clinic.distanceKm * 1000) / 50) * 50} m de você`
              : `${clinic.distanceKm.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km de você`}
        </p>
      )}
      <div className="insurance-tags">
        {clinic.insurances.map((insurance) => (
          <span key={insurance}>{insurance}</span>
        ))}
      </div>
      {!clinic.insurances.length && (
        <p className="clinic-demo-note">Convênios não informados. Consulte a clínica.</p>
      )}
      {!compact && <p className="clinic-address">{clinic.address}</p>}
      {clinic.isDemo ? (
        <p className="clinic-demo-note">Exemplo para testar a busca. Não oferece atendimento.</p>
      ) : (
        <>
          <div className="clinic-links">
            {clinic.phone && (
              <a href={`tel:${clinic.phone}`}>
                <Phone size={14} /> Ligar
              </a>
            )}
            {clinic.website && clinic.website !== clinic.sourceUrl && (
              <a href={clinic.website} target="_blank" rel="noopener noreferrer">
                Site da clínica <ArrowUpRight size={14} />
              </a>
            )}
            {clinic.sourceUrl && (
              <a href={clinic.sourceUrl} target="_blank" rel="noopener noreferrer">
                Fonte do cadastro <ArrowUpRight size={14} />
              </a>
            )}
          </div>
          <p className="clinic-verification">
            Fonte consultada em{' '}
            {clinic.verifiedAt
              ? new Date(clinic.verifiedAt).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
              : 'data não informada'}
            . Confirme o plano, o profissional e a disponibilidade.
          </p>
        </>
      )}
    </article>
  );
}
