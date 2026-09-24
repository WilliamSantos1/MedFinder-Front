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
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function send(input: Omit<ChatRequest, 'history'>) {
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
      const response = await api.chat({ ...input, history }, current.signal);
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
