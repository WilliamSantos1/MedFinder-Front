import { useEffect, useRef, useState } from 'react';
import type { Location } from '../../shared/contracts';

export type GeolocationStatus =
  'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable' | 'error';
interface Position extends Location {
  accuracy: number;
}
export function searchLocation(location: Position | null): Location | undefined {
  return location
    ? {
        latitude: Number(location.latitude.toFixed(4)),
        longitude: Number(location.longitude.toFixed(4)),
      }
    : undefined;
}
export function useGeolocation() {
  const [status, setStatus] = useState<GeolocationStatus>('idle');
  const [location, setLocation] = useState<Position | null>(null);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  useEffect(
    () => () => {
      requestId.current++;
    },
    [],
  );
  function clearLocation() {
    requestId.current++;
    setLocation(null);
    setError('');
    setStatus('idle');
  }
  function requestLocation() {
    if (status === 'requesting') return;
    setError('');
    if (!navigator.geolocation || !window.isSecureContext) {
      setStatus('unavailable');
      setError(
        'Localização indisponível. Use localhost ou uma conexão HTTPS; você também pode filtrar por cidade.',
      );
      return;
    }
    const id = ++requestId.current;
    setStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (id !== requestId.current) return;
        const { latitude, longitude, accuracy } = position.coords;
        if (
          ![latitude, longitude, accuracy].every(Number.isFinite) ||
          Math.abs(latitude) > 90 ||
          Math.abs(longitude) > 180 ||
          accuracy < 0
        ) {
          setStatus('error');
          setError('Não foi possível validar a localização. Use o filtro de cidade.');
          return;
        }
        setLocation({ latitude, longitude, accuracy });
        setStatus('granted');
      },
      (failure) => {
        if (id !== requestId.current) return;
        setLocation(null);
        setStatus(failure.code === 1 ? 'denied' : failure.code === 2 ? 'unavailable' : 'error');
        setError(
          failure.code === 1
            ? 'Permissão de localização negada. Você pode continuar usando cidade e convênio.'
            : failure.code === 3
              ? 'A localização demorou a responder. Tente novamente quando desejar ou escolha uma cidade.'
              : 'Não foi possível obter sua localização. Você pode escolher uma cidade.',
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }
  return { status, location, error, requestLocation, clearLocation };
}
export type GeolocationState = ReturnType<typeof useGeolocation>;
