import { AlertTriangle, ArrowUpRight, BookOpen, HeartPulse, Phone } from 'lucide-react';
import type { ChatResponse } from '../../../shared/contracts';
import { ClinicCard } from '../clinics/ClinicCard';
import { ResponseFeedback } from './ResponseFeedback';

const messages: Partial<Record<ChatResponse['status'], string>> = {
  specialty_unrecognized:
    'Não foi possível reconhecer a especialidade sugerida. Nenhuma clínica foi selecionada automaticamente.',
  specialty_not_registered:
    'Especialidade sugerida ainda não cadastrada ou habilitada no catálogo. Nenhuma outra especialidade foi escolhida em seu lugar.',
  no_matching_clinics:
    'Nenhuma clínica do catálogo corresponde a esta consulta e aos filtros escolhidos.',
};
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
                : response.mode === 'catalog'
                  ? 'CATÁLOGO'
                  : response.mode === 'ollama'
                    ? 'IA LOCAL'
                    : 'IA · ORIENTAÇÃO'}
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
      {response.specialty && (
        <div className="specialty-suggestions">
          <section>
            <small>
              {response.intent === 'care_navigation'
                ? urgent
                  ? 'Área relacionada à avaliação'
                  : 'Especialidade sugerida'
                : 'Especialidade pesquisada'}
            </small>
            <h3>{response.specialty.name}</h3>
            {response.specialty.reason && <p>{response.specialty.reason}</p>}
          </section>
        </div>
      )}
      {messages[response.status] && <p className="empty-inline">{messages[response.status]}</p>}
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
      {!urgent && response.clinics.length > 0 && (
        <section className="chat-clinics">
          <h3>Opções no catálogo</h3>
          <p className="result-note">
            {response.locationUsed ? 'Ordenado por proximidade. ' : ''}
            Filtros aplicados no envio. Confirme cobertura e disponibilidade diretamente com a
            clínica.
          </p>
          {response.clinics.map((clinic) => (
            <ClinicCard
              key={clinic.id}
              clinic={clinic}
              compact
              showDistance={response.locationUsed}
            />
          ))}
        </section>
      )}
      {response.ragStatus === 'unavailable' && (
        <p className="result-note">
          Os textos complementares das clínicas estão indisponíveis. Os dados do catálogo continuam
          disponíveis acima.
        </p>
      )}
      {response.ragStatus === 'not_indexed' && (
        <p className="result-note">
          Ainda não há informações complementares destas clínicas. Consulte as fontes dos cadastros.
        </p>
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
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.title}
                    <ArrowUpRight size={14} />
                  </a>
                ) : (
                  <strong>{source.title}</strong>
                )}
                <small>
                  {source.publisher}
                  {source.isDemo && ' · Texto fictício de demonstração'}
                </small>
                <p>{source.excerpt}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="response-notice">{response.notice}</p>
      <ResponseFeedback response={response} />
    </article>
  );
}
