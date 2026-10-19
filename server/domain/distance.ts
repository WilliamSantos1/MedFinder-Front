import { locationSchema } from '../../shared/contracts.js';

/** Great-circle distance in km. Not a travel route, travel time or medical ranking. */
export function distanceKm(
  originLat: number,
  originLng: number,
  destinationLat: number,
  destinationLng: number,
) {
  locationSchema.parse({ latitude: originLat, longitude: originLng });
  locationSchema.parse({ latitude: destinationLat, longitude: destinationLng });
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const a =
    Math.sin(radians(destinationLat - originLat) / 2) ** 2 +
    Math.cos(radians(originLat)) *
      Math.cos(radians(destinationLat)) *
      Math.sin(radians(destinationLng - originLng) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
}
