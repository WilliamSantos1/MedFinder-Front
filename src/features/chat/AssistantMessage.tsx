import { AlertTriangle, ArrowUpRight, BookOpen, HeartPulse, Phone } from 'lucide-react';
import { specialties, type ChatResponse } from '../../../shared/contracts';
import { ClinicCard } from '../clinics/ClinicCard';

export function AssistantMessage({ response }: { response: ChatResponse }) {
  const urgent = response.urgency === 'emergency' || response.urgency === 'prompt';
  return (
    <article className={`assistant-message ${urgent ? 'urgent-message' : ''}`}>
      <div className="message-author">
        <HeartPulse size={15} /> MedFinder{' '}
        <span>
          {response.mode === 'demo'
            ? 'DEMONSTRAÇÃO'
            : response.mode === 'fallback'
              ? 'INFORMAÇÃO LIMITADA'
              : urgent
                ? 'ATENÇÃO'
                : response.mode === 'ollama'
                  ? 'IA LOCAL · COM FONTES'
                  : 'COM FONTES'}
        </span>
      </div>
      {urgent && (
        <h3 className="urgent-title">
          <AlertTriangle size={20} />
          {response.urgency === 'emergency'
            ? 'Busque ajuda imediatamente'
            : 'Procure avaliação presencial'}
        </h3>
      )}
      <p className="answer-text">{response.answer}</p>
      {response.urgency === 'emergency' && (
        <a className="emergency-button" href="tel:192">
          <Phone size={17} /> Ligar para o SAMU 192
        </a>
      )}
      {response.specialtyIds.length > 0 && (
        <div className="specialty-tags">
          {response.specialtyIds.map((id) => (
            <span key={id}>{specialties[id]}</span>
          ))}
        </div>
      )}
      {response.questions.length > 0 && (
        <div className="follow-up">
          <strong>Para entender melhor</strong>
          <ul>
            {response.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      )}
      {!urgent && response.specialtyIds.length > 0 && (
        <section className="chat-clinics">
          <h3>Opções no catálogo</h3>
          <p className="result-note">
            Filtros aplicados no envio. Confirme cobertura e disponibilidade diretamente com a
            clínica.
          </p>
          {response.clinics.length ? (
            response.clinics.map((clinic) => <ClinicCard key={clinic.id} clinic={clinic} compact />)
          ) : (
            <p className="empty-inline">
              Nenhuma clínica cadastrada corresponde à especialidade e aos filtros escolhidos.
              Experimente outra cidade ou convênio.
            </p>
          )}
        </section>
      )}
      {response.sources.length > 0 && (
        <details className="source-details">
          <summary>
            <BookOpen size={14} />
            {response.sources.length}{' '}
            {response.sources.length === 1 ? 'fonte consultada' : 'fontes consultadas'}
          </summary>
          <ul>
            {response.sources.map((source) => (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title}
                  <ArrowUpRight size={14} />
                </a>
                <small>
                  {source.publisher}
                  {source.reviewStatus === 'draft' && ' · Resumo sem revisão clínica local'}
                </small>
                <p>{source.excerpt}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="response-notice">{response.notice}</p>
    </article>
  );
}
