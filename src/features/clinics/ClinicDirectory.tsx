import { useEffect, useState } from 'react';
import { Building2, ChevronLeft, ChevronRight, LoaderCircle, Search } from 'lucide-react';
import { specialties, type ClinicResults } from '../../../shared/contracts';
import { CareFilters, type CareFilterProps } from '../../components/CareFilters';
import { api } from '../../lib/api';
import { ClinicCard } from './ClinicCard';

export function ClinicDirectory(props: CareFilterProps) {
  const [specialty, setSpecialty] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const query = new URLSearchParams({
    city: props.city,
    insurance: props.insurance,
    specialty,
    q: search,
    page: String(page),
  }).toString();
  const key = `${query}|${attempt}`;
  const [result, setResult] = useState<{ key: string; data?: ClinicResults; error?: string }>();
  const loading = result?.key !== key;
  useEffect(() => {
    const controller = new AbortController();
    api
      .clinics(query, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            error:
              error instanceof Error ? error.message : 'Não foi possível consultar o catálogo.',
          });
      });
    return () => controller.abort();
  }, [query, key]);
  return (
    <section className="directory" aria-label="Catálogo de clínicas">
      {props.catalog && (
        <div className="catalog-context">
          <p>
            Dados com fonte e data de consulta. Convênios podem variar por profissional e modalidade
            de atendimento.
          </p>
          <p>
            {props.catalog.directory.realRecords} unidades com fontes públicas em{' '}
            {props.catalog.cities.length} cidades. Cadastro consultado nos sites; sem consulta de
            agenda em tempo real.
          </p>
        </div>
      )}
      <form
        className="directory-search"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}
      >
        <label htmlFor="clinic-search">Nome, bairro ou endereço</label>
        <div>
          <input
            id="clinic-search"
            type="search"
            value={searchInput}
            maxLength={100}
            placeholder="Ex.: Clínica FAM ou Aldeota"
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <button type="submit" className="primary-button">
            <Search size={17} /> Buscar
          </button>
        </div>
      </form>
      <div className="directory-filters">
        <CareFilters
          {...props}
          onCityChange={(value) => {
            setPage(1);
            props.onCityChange(value);
          }}
          onInsuranceChange={(value) => {
            setPage(1);
            props.onInsuranceChange(value);
          }}
        />
        <div className="filter-control specialty-filter">
          <Search size={16} />
          <label htmlFor="specialty">Especialidade</label>
          <select
            id="specialty"
            value={specialty}
            onChange={(event) => {
              setPage(1);
              setSpecialty(event.target.value);
            }}
          >
            <option value="">Todas as especialidades</option>
            {Object.entries(specialties).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {loading ? (
        <div className="directory-status" role="status">
          <LoaderCircle size={24} className="spin" />
          <p>Consultando o catálogo…</p>
        </div>
      ) : result?.error ? (
        <div className="directory-status" role="alert">
          <p>{result.error}</p>
          <button
            className="primary-button"
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Tentar novamente
          </button>
        </div>
      ) : (
        <>
          <div className="directory-count">
            <h2>
              {result?.data?.total ?? 0}{' '}
              {(result?.data?.total ?? 0) === 1 ? 'opção encontrada' : 'opções encontradas'}
            </h2>
            <span>Ordenação por nome · sem ranking médico</span>
          </div>
          {!result?.data?.items.length ? (
            <div className="directory-status">
              <Building2 size={35} />
              <h3>Nenhuma opção para esses filtros</h3>
              <p>Revise a busca ou escolha outra especialidade, cidade ou convênio.</p>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setSpecialty('');
                  setSearch('');
                  setSearchInput('');
                  setPage(1);
                  props.onCityChange('');
                  props.onInsuranceChange('');
                }}
              >
                Limpar filtros
              </button>
            </div>
          ) : (
            <div className="clinic-grid">
              {result.data.items.map((clinic) => (
                <ClinicCard key={clinic.id} clinic={clinic} />
              ))}
            </div>
          )}
          {result?.data && result.data.total > result.data.pageSize && (
            <div className="pagination">
              <button
                type="button"
                onClick={() => setPage((value) => value - 1)}
                disabled={page === 1}
                aria-label="Página anterior"
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                Página {page} de {Math.ceil(result.data.total / result.data.pageSize)}
              </span>
              <button
                type="button"
                onClick={() => setPage((value) => value + 1)}
                disabled={page * result.data.pageSize >= result.data.total}
                aria-label="Próxima página"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
