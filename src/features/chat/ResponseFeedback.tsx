import { useId, useRef, useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { ChatResponse, FeedbackReason, FeedbackRequest } from '../../../shared/contracts';
import { api } from '../../lib/api';

const labels: Record<FeedbackReason, string> = {
  incorrect_specialty: 'A especialidade sugerida não parece adequada',
  unclear_answer: 'A resposta ficou confusa',
  not_helpful: 'A resposta não me ajudou',
  clinic_problem: 'As clínicas apresentadas não foram úteis',
  location_problem: 'Problema com localização/distância',
  insurance_problem: 'Problema com convênio',
  too_slow: 'A resposta demorou muito',
  other: 'Outro',
};
export function ResponseFeedback({ response }: { response: ChatResponse }) {
  const id = useId();
  const [state, setState] = useState<'idle' | 'submitting' | 'submitted' | 'error'>('idle');
  const [rating, setRating] = useState<'positive' | 'negative' | null>(null);
  const [reason, setReason] = useState<FeedbackReason | null>(null);
  const [comment, setComment] = useState('');
  const [panel, setPanel] = useState(false);
  const busy = useRef(false);
  if (!response.feedback) return null;
  const { token, reasons } = response.feedback;
  async function submit(next: FeedbackRequest['rating']) {
    if (busy.current || (next === 'negative' && !reason)) return;
    busy.current = true;
    setRating(next);
    setState('submitting');
    try {
      await api.feedback({
        responseId: response.id,
        token,
        rating: next,
        ...(next === 'negative' && reason ? { reason, comment } : {}),
      });
      setState('submitted');
      setPanel(false);
      setComment('');
    } catch {
      setState('error');
    } finally {
      busy.current = false;
    }
  }
  return (
    <section className="response-feedback" aria-label="Avaliar resposta">
      <p>Essa resposta foi útil?</p>
      <div className="feedback-actions">
        <button
          type="button"
          disabled={state === 'submitting'}
          aria-pressed={rating === 'positive'}
          onClick={() => {
            setPanel(false);
            void submit('positive');
          }}
        >
          <ThumbsUp size={15} /> Sim
        </button>
        <button
          type="button"
          disabled={state === 'submitting'}
          aria-pressed={rating === 'negative'}
          aria-expanded={panel}
          aria-controls={`${id}-panel`}
          onClick={() => {
            setRating('negative');
            setPanel(true);
            setState('idle');
          }}
        >
          <ThumbsDown size={15} /> Não
        </button>
      </div>
      {panel && (
        <form
          id={`${id}-panel`}
          className="feedback-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void submit('negative');
          }}
        >
          <fieldset disabled={state === 'submitting'}>
            <legend>O que poderia melhorar?</legend>
            {reasons.map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name={`${id}-reason`}
                  value={value}
                  checked={reason === value}
                  onChange={() => setReason(value)}
                  required
                />
                {labels[value]}
              </label>
            ))}
          </fieldset>
          <label htmlFor={`${id}-comment`}>Comentário opcional</label>
          <textarea
            id={`${id}-comment`}
            maxLength={500}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={state === 'submitting'}
            aria-describedby={`${id}-privacy`}
            rows={3}
          />
          <small id={`${id}-privacy`}>
            Não inclua sintomas ou dados pessoais. O comentário será salvo para avaliar a utilidade
            do sistema.
          </small>
          <button
            className="primary-button"
            type="submit"
            disabled={!reason || state === 'submitting'}
          >
            Enviar feedback
          </button>
          <button
            className="text-button"
            type="button"
            disabled={state === 'submitting'}
            onClick={() => {
              setPanel(false);
              setComment('');
            }}
          >
            Cancelar
          </button>
        </form>
      )}
      {state === 'submitting' && <p role="status">Enviando feedback…</p>}
      {state === 'submitted' && (
        <p role="status">Obrigado pelo feedback. Você pode alterar seu voto.</p>
      )}
      {state === 'error' && (
        <p role="alert">
          Não foi possível salvar o feedback. Tente novamente; a conversa continua disponível.
        </p>
      )}
    </section>
  );
}
