import { useEffect, useRef, useState } from 'react';
import { discardItems, dueItems, touchLastSeen, type FollowUpItem } from './storage';

const HEARTBEAT_MS = 30_000;

export function useReturnFollowUp() {
  // Decide antes de qualquer atualização de "visto por último".
  const [pending, setPending] = useState<FollowUpItem[]>(() => dueItems());
  const open = useRef(pending.length > 0);

  useEffect(() => {
    // Com a pergunta na tela, não renovamos o horário: se a pessoa fechar sem responder, perguntamos de novo.
    if (!open.current) touchLastSeen();
    const onChange = () => {
      if (open.current) return;
      if (document.visibilityState === 'visible') {
        // Celular: o app costuma ficar em segundo plano em vez de fechar de verdade.
        const due = dueItems();
        if (due.length) {
          open.current = true;
          setPending(due);
        } else touchLastSeen();
      } else touchLastSeen();
    };
    const onHide = () => {
      if (!open.current) touchLastSeen();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !open.current) touchLastSeen();
    }, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', onChange);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onChange);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  function finish(responseIds: string[]) {
    discardItems(responseIds);
    open.current = false;
    setPending([]);
  }
  return { pending, finish };
}
