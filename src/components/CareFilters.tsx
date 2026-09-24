import { MapPin, WalletCards } from 'lucide-react';
import { useId } from 'react';
import type { CatalogMeta } from '../../shared/contracts';

export interface CareFilterProps {
  catalog?: CatalogMeta;
  city: string;
  insurance: string;
  onCityChange: (value: string) => void;
  onInsuranceChange: (value: string) => void;
}

export function CareFilters({
  catalog,
  city,
  insurance,
  onCityChange,
  onInsuranceChange,
}: CareFilterProps) {
  const id = useId();
  return (
    <div className="care-filters">
      <div className="filter-control">
        <MapPin size={16} aria-hidden="true" />
        <label htmlFor={`${id}-city`}>Cidade</label>
        <select
          id={`${id}-city`}
          value={city}
          onChange={(event) => onCityChange(event.target.value)}
          disabled={!catalog}
        >
          <option value="">Todas as cidades</option>
          {catalog?.cities.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
      <div className="filter-control">
        <WalletCards size={16} aria-hidden="true" />
        <label htmlFor={`${id}-insurance`}>Convênio</label>
        <select
          id={`${id}-insurance`}
          value={insurance}
          onChange={(event) => onInsuranceChange(event.target.value)}
          disabled={!catalog}
        >
          <option value="">Todos os convênios</option>
          {catalog?.insurances.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
