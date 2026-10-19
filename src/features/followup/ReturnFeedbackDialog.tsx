import { useEffect, useId, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { api } from '../../lib/api';
import type { FollowUpItem } from './storage';

type Props = { items: FollowUpItem[]; onFinish: (responseIds: string[]) => void };

export function ReturnFeedbackDialog({ items, onFinish }: Props) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Itens vêm do mais novo para o mais antigo; mantém a indicação mais recente de cada clínica.
  const options = [
    ...new Map(
      items
        .flatMap((item) => item.clinics.map((clinic) => [clinic.id, { clinic, item }] as const))
        .reverse(),
    ).values(),
  ].reverse();
  const allIds = items.map((item) => item.responseId);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  async function submit() {
    const option = options.find((entry) => entry.clinic.id === selected);
    if (!option || !rating || sending) return;
    setSending(true);
    setError('');
    try {
      await api.visitFeedback({
        responseId: option.item.responseId,
        token: option.item.token,
        clinicId: option.clinic.id,
        rating,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      onFinish(allIds);
    } catch {
      setError('Não foi possível enviar agora. Tente novamente ou feche esta janela.');
      setSending(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="return-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onFinish(allIds);
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 id={`${id}-title`}>Que bom ver você de novo</h2>
        <p>
          Da última vez indicamos algumas clínicas. Você foi a alguma delas? Sua avaliação é anônima
          e ajuda a melhorar as indicações.
        </p>
        <fieldset disabled={sending}>
          <legend>Qual clínica você visitou?</legend>
          {options.map(({ clinic }) => (
            <label key={clinic.id}>
              <input
                type="radio"
                name={`${id}-clinic`}
                value={clinic.id}
                checked={selected === clinic.id}
                onChange={() => setSelected(clinic.id)}
              />
              {clinic.name}
            </label>
          ))}
        </fieldset>
        {selected && (
          <>
            <fieldset className="star-rating" disabled={sending}>
              <legend>Como foi a experiência?</legend>
              <div>
                {[1, 2, 3, 4, 5].map((value) => (
                  <label key={value}>
                    <input
                      className="sr-only"
                      type="radio"
                      name={`${id}-rating`}
                      value={value}
                      checked={rating === value}
                      onChange={() => setRating(value)}
                    />
                    <Star
                      size={30}
                      className={value <= rating ? 'star filled' : 'star'}
                      aria-hidden="true"
                    />
                    <span className="sr-only">
                      {value} {value === 1 ? 'estrela' : 'estrelas'}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label htmlFor={`${id}-comment`}>Comentário opcional</label>
            <textarea
              id={`${id}-comment`}
              rows={3}
              maxLength={500}
              value={comment}
              disabled={sending}
              onChange={(event) => setComment(event.target.value)}
            />
            <small>Não inclua dados pessoais nem sintomas.</small>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="return-actions">
          <button
            className="primary-button"
            type="submit"
            disabled={!selected || !rating || sending}
          >
            Enviar avaliação
          </button>
          <button
            className="text-button"
            type="button"
            disabled={sending}
            onClick={() => onFinish(allIds)}
          >
            Não fui a nenhuma
          </button>
        </div>
      </form>
    </dialog>
  );
}
