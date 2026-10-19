import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  CircleHelp,
  HeartPulse,
  LoaderCircle,
  LockKeyhole,
  Square,
} from 'lucide-react';
import { CareFilters, type CareFilterProps } from '../../components/CareFilters';
import { useChat } from './useChat';
import { LocationControl } from '../../components/LocationControl';
import { searchLocation } from '../../hooks/useGeolocation';
import { AssistantMessage } from './AssistantMessage';

const suggestions = [
  'Estou com dor no pescoço',
  'Minha pele está coçando',
  'Qual clínica de oftalmologia está mais perto?',
];

export function ChatPanel(props: CareFilterProps) {
  const { messages, pending, error, send, cancel } = useChat(props.catalog?.chatTimeoutMs);
  const [input, setInput] = useState('');
  const [consent, setConsent] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  // The API can issue a local emergency response without sending data to the AI.
  // It enforces consent before any request reaches the external provider.
  const ready = Boolean(props.catalog);
  useEffect(() => {
    const area = scrollArea.current;
    if (area && (messages.length > 0 || pending)) area.scrollTop = area.scrollHeight;
  }, [messages, pending]);

  async function submit() {
    const message = input.trim();
    if (!message || message.length > 2000 || pending || !ready) return;
    setInput('');
    const success = await send({
      message,
      city: props.city,
      insurance: props.insurance,
      consent,
      location: searchLocation(props.geolocation.location),
    });
    if (!success) setInput((draft) => draft || message);
    textarea.current?.focus();
  }
  function fill(text: string) {
    setInput(text);
    textarea.current?.focus();
  }

  return (
    <section className="chat-panel" aria-label="Conversa com o MedFinder">
      <div className="chat-header">
        <div className="assistant-avatar">
          <HeartPulse size={23} />
        </div>
        <div>
          <h2>Assistente MedFinder</h2>
          <p>
            <span className={`status-dot ${!props.catalog ? 'offline' : ''}`} />
            {props.catalog
              ? props.catalog.mode === 'demo'
                ? 'Modo demonstração'
                : props.catalog.mode === 'ollama'
                  ? 'IA local · Ollama'
                  : 'IA · orientação de atendimento'
              : 'Conectando ao serviço…'}
          </p>
        </div>
      </div>
      <CareFilters {...props} />
      <LocationControl geolocation={props.geolocation} />
      <div
        className={`conversation ${messages.length ? 'has-messages' : ''}`}
        ref={scrollArea}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Mensagens da conversa"
        aria-busy={pending}
      >
        {messages.length === 0 && (
          <div className="chat-welcome">
            <div className="welcome-icon">
              <HeartPulse size={32} strokeWidth={1.5} />
            </div>
            <span className="welcome-eyebrow">PODE FALAR. ESTAMOS AQUI.</span>
            <h3>Como você está se sentindo?</h3>
            <p>
              Conte seu desconforto ou pergunte sobre clínicas.
              <br />
              Busque por especialidade, convênio ou proximidade.
            </p>
            <div className="suggestions">
              {suggestions.map((suggestion) => (
                <button type="button" key={suggestion} onClick={() => fill(suggestion)}>
                  <CircleHelp size={15} />
                  {suggestion}
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
            <div className="welcome-footnote">
              <Check size={14} /> Sem cadastro <span>·</span> No seu tempo
            </div>
          </div>
        )}
        {messages.map((message) =>
          message.role === 'user' ? (
            <div className="user-message" key={message.id}>
              <span className="message-author">Você</span>
              <p>{message.text}</p>
            </div>
          ) : (
            <AssistantMessage key={message.id} response={message.response} />
          ),
        )}
        {pending && (
          <div className="pending-message" role="status">
            <LoaderCircle className="spin" size={17} />
            <span>
              {props.catalog?.mode === 'ollama'
                ? 'A IA local está preparando a orientação. A primeira resposta pode demorar…'
                : 'Consultando informações e opções de atendimento…'}
            </span>
          </div>
        )}
      </div>
      <div className="composer-area">
        {props.catalog?.requiresConsent && (
          <label className="consent-control">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              disabled={pending}
            />
            <span>
              Autorizo o envio do relato e das mensagens recentes à OpenAI para gerar a orientação.
              Evitarei dados de identificação.
            </span>
          </label>
        )}
        {error && (
          <p className="composer-error" role="alert">
            {error}
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="composer">
            <label className="sr-only" htmlFor="complaint">
              Descreva o que você está sentindo
            </label>
            <textarea
              ref={textarea}
              id="complaint"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="Ex.: qual clínica de oftalmologia está mais perto?"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            {pending ? (
              <button
                className="send-button"
                type="button"
                onClick={cancel}
                aria-label="Interromper envio"
              >
                <Square size={16} />
              </button>
            ) : (
              <button
                className="send-button"
                type="submit"
                disabled={!input.trim() || !ready}
                aria-label="Enviar mensagem"
              >
                <ArrowUp size={22} />
              </button>
            )}
          </div>
          <div className="composer-footer">
            <span>
              <LockKeyhole size={12} /> Evite informações pessoais
            </span>
            <span>
              {input.length > 1700
                ? `${input.length}/2000`
                : 'Enter para enviar · Shift + Enter para pular linha'}
            </span>
          </div>
        </form>
        <p className="chat-disclaimer">
          Não substitui avaliação médica. Emergência? <a href="tel:192">SAMU 192</a>.
        </p>
      </div>
    </section>
  );
}
