
import { useEffect, useState } from 'react';
import {MapContainer,TileLayer,Marker,Popup,Polyline,useMap,} from 'react-leaflet';
import { X, MapPin, Navigation, LoaderCircle } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './ClinicRouteModal.css';

interface Coordinates {
  latitude: number;
  longitude: number;
}

interface ClinicRouteModalProps {
  userLocation: Coordinates;
  clinicLocation: Coordinates;
  clinicName: string;
}

interface RouteResponse {
  routes: {
    distance: number;
    duration: number;
    geometry: {
      coordinates: [number, number][];
    };
  }[];
}

// Ajusta o enquadramento do mapa para mostrar os dois pontos
function MapBounds({
  userLocation,
  clinicLocation,
}: {
  userLocation: Coordinates;
  clinicLocation: Coordinates;
}) {
  const map = useMap();

  useEffect(() => {
    const bounds = L.latLngBounds([
      [userLocation.latitude, userLocation.longitude],
      [clinicLocation.latitude, clinicLocation.longitude],
    ]);

    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, userLocation, clinicLocation]);

  return null;
}

export function ClinicRouteModal({
  userLocation,
  clinicLocation,
  clinicName,
}: ClinicRouteModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [route, setRoute] = useState<[number, number][] | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
  console.log('--- LOCALIZAÇÃO RECEBIDA PELO MAPA ---');
  console.log(userLocation);
}, [userLocation]);

  async function handleOpenModal() {
    setIsOpen(true);
    setError(null);

    if (route) return;

    setLoading(true);

    try {
      const url =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${userLocation.longitude},${userLocation.latitude};` +
        `${clinicLocation.longitude},${clinicLocation.latitude}` +
        `?overview=full&geometries=geojson`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error('Erro ao consultar o serviço de rotas.');
      }

      const data: RouteResponse = await response.json();

      if (!data.routes?.length) {
        throw new Error('Nenhuma rota encontrada.');
      }

      const routeData = data.routes[0];

      // OSRM retorna [longitude, latitude].
      // Leaflet utiliza [latitude, longitude].
      const coordinates = routeData.geometry.coordinates.map(
        ([longitude, latitude]) => [latitude, longitude] as [number, number]
      );

      setRoute(coordinates);
      setDistance(routeData.distance);
      setDuration(routeData.duration);
    } catch {
      setError('Não foi possível calcular a rota. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  function handleCloseModal() {
    setIsOpen(false);
  }

  const formatDistance = (meters: number) => {
    return meters >= 1000
      ? `${(meters / 1000).toLocaleString('pt-BR', {
          maximumFractionDigits: 1,
        })} km`
      : `${Math.round(meters)} m`;
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.round(seconds / 60);

    if (minutes < 60) return `${minutes} min`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return remainingMinutes
      ? `${hours} h ${remainingMinutes} min`
      : `${hours} h`;
  };

  return (
    <>
      <button
        type="button"
        className="clinic-route-button"
        onClick={handleOpenModal}
      >
        <Navigation size={15} />
        Como chegar
      </button>

      {isOpen && (
        <div
          className="route-modal-overlay"
          onClick={handleCloseModal}
        >
          <div
            className="route-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="route-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="route-modal-header">
              <div>
                <span className="route-modal-subtitle">
                  ROTA ATÉ A CLÍNICA
                </span>
                <h2 id="route-modal-title">{clinicName}</h2>
              </div>

              <button
                type="button"
                className="route-modal-close"
                onClick={handleCloseModal}
                aria-label="Fechar modal"
              >
                <X size={20} />
              </button>
            </header>

            {loading && (
              <div className="route-modal-loading">
                <LoaderCircle className="loading-icon" size={28} />
                <p>Calculando rota...</p>
              </div>
            )}

            {error && (
              <div className="route-modal-error">
                <p>{error}</p>
                <button onClick={handleOpenModal}>
                  Tentar novamente
                </button>
              </div>
            )}

            {route && !loading && (
              <>
                <div className="route-info">
                  <div>
                    <MapPin size={17} />
                    <span>Distância</span>
                    <strong>
                      {distance !== null
                        ? formatDistance(distance)
                        : '--'}
                    </strong>
                  </div>

                  <div>
                    <Navigation size={17} />
                    <span>Tempo estimado</span>
                    <strong>
                      {duration !== null
                        ? formatDuration(duration)
                        : '--'}
                    </strong>
                  </div>
                </div>

                <div className="route-map-container">
                  <MapContainer
                    center={[
                      userLocation.latitude,
                      userLocation.longitude,
                    ]}
                    zoom={13}
                    className="route-map"
                    scrollWheelZoom
                  >
                    <TileLayer
                      attribution='&copy; OpenStreetMap contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    <Marker
                      position={[
                        userLocation.latitude,
                        userLocation.longitude,
                      ]}
                    >
                      <Popup>Sua localização</Popup>
                    </Marker>

                    <Marker
                      position={[
                        clinicLocation.latitude,
                        clinicLocation.longitude,
                      ]}
                    >
                      <Popup>{clinicName}</Popup>
                    </Marker>

                    <Polyline
                      positions={route}
                      pathOptions={{
                        color: '#2563eb',
                        weight: 5,
                        opacity: 0.85,
                      }}
                    />

                    <MapBounds
                      userLocation={userLocation}
                      clinicLocation={clinicLocation}
                    />
                  </MapContainer>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
