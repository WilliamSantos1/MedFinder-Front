import { LocateFixed, LoaderCircle, X } from 'lucide-react';
import type { GeolocationState } from '../hooks/useGeolocation';

export function LocationControl({ geolocation }: { geolocation: GeolocationState }) {
  const { status, error, requestLocation, clearLocation } = geolocation;
  return (
    <div className="location-control">
      <div className="location-actions">
        <button
          type="button"
          className="text-button"
          onClick={requestLocation}
          disabled={status === 'requesting'}
        >
          {status === 'requesting' ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <LocateFixed size={16} />
          )}
          {status === 'granted' ? 'Atualizar minha localização' : 'Usar minha localização'}
        </button>
        {(status === 'granted' || status === 'requesting') && (
          <button type="button" className="text-button" onClick={clearLocation}>
            <X size={15} /> Remover localização
          </button>
        )}
      </div>
      <p role="status">
        {error ||
          (status === 'granted'
            ? 'Localização ativa. Distâncias em linha reta; não indicam tempo de viagem ou qualidade médica.'
            : status === 'requesting'
              ? 'Aguardando a localização…'
              : 'Use sua localização para encontrar clínicas mais próximas. Sua posição não será armazenada.')}
      </p>
    </div>
  );
}
