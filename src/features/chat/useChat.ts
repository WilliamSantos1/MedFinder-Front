import { useEffect, useRef, useState } from 'react';
import type { ChatRequest, ChatResponse } from '../../../shared/contracts';
import { api } from '../../lib/api';

export type Message =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; response: ChatResponse };

export function useChat(timeoutMs = 60000) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lastFilters = useRef<{ city: string; insurance: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function send(input: Omit<ChatRequest, 'history' | 'context'>) {
    if (controller.current) return false;
    const current = new AbortController();
    controller.current = current;
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', text: input.message };
    const history = messages
      .filter((item) => item.role === 'user')
      .map((item) => item.text)
      .slice(-6);
    setMessages((previous) => [...previous, userMessage]);
    setError('');
    setPending(true);
    const timeout = window.setTimeout(() => current.abort(), timeoutMs);
    try {
      const previous = [...messages].reverse().find((item) => item.role === 'assistant');
      const context =
        previous?.role === 'assistant' && previous.response.context
          ? {
              ...previous.response.context,
              city:
                lastFilters.current?.city === input.city
                  ? previous.response.context.city
                  : input.city,
              insurance:
                lastFilters.current?.insurance === input.insurance
                  ? previous.response.context.insurance
                  : input.insurance,
            }
          : undefined;
      const response = await api.chat({ ...input, history, context }, current.signal);
      lastFilters.current = { city: input.city, insurance: input.insurance };
      setMessages((previous) => [...previous, { id: response.id, role: 'assistant', response }]);
      return true;
    } catch (failure) {
      setMessages((previous) => previous.filter((item) => item.id !== userMessage.id));
      setError(
        current.signal.aborted
          ? 'Envio interrompido. Sua mensagem foi preservada para tentar novamente.'
          : failure instanceof Error
            ? failure.message
            : 'Não foi possível enviar a mensagem.',
      );
      return false;
    } finally {
      clearTimeout(timeout);
      controller.current = null;
      setPending(false);
    }
  }
  return { messages, pending, error, send, cancel: () => controller.current?.abort() };
}
