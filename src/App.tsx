import { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Building2,
  ChevronRight,
  HeartPulse,
  LockKeyhole,
  MessageCircle,
  Plus,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { ChatPanel } from './features/chat/ChatPanel';
import { ClinicDirectory } from './features/clinics/ClinicDirectory';
import { useCatalog } from './hooks/useCatalog';
import './App.css';

type View = 'chat' | 'clinics' | 'about';
const navigation = [
  { id: 'chat' as const, label: 'Assistente de saúde', icon: MessageCircle },
  { id: 'clinics' as const, label: 'Encontrar clínicas', icon: Building2 },
  { id: 'about' as const, label: 'Como funciona', icon: BookOpen },
];

export default function App() {
  const [view, setView] = useState<View>('chat');
  const [session, setSession] = useState(0);
  const [city, setCity] = useState('');
  const [insurance, setInsurance] = useState('');
  const { data: catalog, error, retry } = useCatalog();
  function newConversation() {
    setSession((value) => value + 1);
    setView('chat');
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Pular para o conteúdo
      </a>
      <aside className="sidebar" aria-label="Menu principal">
        <a
          className="brand"
          href="#main"
          onClick={() => setView('chat')}
          aria-label="MedFinder, início"
        >
          <span className="brand-icon">
            <HeartPulse size={23} strokeWidth={2.2} />
          </span>
          <span>
            med<span className="brand-light">finder</span>
            <span className="brand-dot">.</span>
          </span>
        </a>
        <p className="sidebar-label">SEU ESPAÇO DE CUIDADO</p>
        <nav>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              onClick={() => setView(id)}
              className={`nav-item ${view === id ? 'active' : ''}`}
              aria-current={view === id ? 'page' : undefined}
            >
              <Icon size={19} />
              <span>{label}</span>
              {view === id && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <button type="button" className="new-chat" onClick={newConversation}>
          <Plus size={18} /> Nova conversa
        </button>
        <div className="sidebar-bottom">
          <div className="sidebar-care">
            <span className="care-symbol">
              <HeartPulse size={25} />
            </span>
            <h3>Um passo de cada vez.</h3>
            <p>Encontrar o cuidado certo começa por entender o que você precisa.</p>
          </div>
          <div className="privacy-caption">
            <LockKeyhole size={14} />
            <span>Seu relato merece cuidado</span>
          </div>
          <p className="sidebar-version">MedFinder · orientação de atendimento</p>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            Seu cuidado <ChevronRight size={14} />{' '}
            <strong>{navigation.find((item) => item.id === view)?.label}</strong>
          </span>
          <span className="privacy-pill">
            <ShieldCheck size={15} /> Sem cadastro
          </span>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="page-intro">
            <div>
              <p className="eyebrow">
                <span /> CUIDADO QUE COMEÇA COM UMA CONVERSA
              </p>
              <h1>
                {view === 'chat' ? (
                  <>
                    Vamos encontrar seu
                    <br />
                    <span>próximo passo.</span>
                  </>
                ) : view === 'clinics' ? (
                  <>
                    Encontre um lugar
                    <br />
                    <span>para cuidar de você.</span>
                  </>
                ) : (
                  <>
                    Informação clara.
                    <br />
                    <span>Escolhas com contexto.</span>
                  </>
                )}
              </h1>
              <p className="intro-description">
                {view === 'chat'
                  ? 'Conte o que você está sentindo. A gente ajuda a encontrar por onde começar.'
                  : view === 'clinics'
                    ? 'Consulte especialidades, localização e convênios no nosso catálogo.'
                    : 'Entenda como seu relato se transforma em uma orientação de atendimento.'}
              </p>
            </div>
            <div className="intro-mark" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <HeartPulse size={58} strokeWidth={1.35} />
              <span className="orbit-dot" />
            </div>
          </div>
          {error && (
            <div className="notice error-notice" role="alert">
              <span>Não foi possível conectar ao serviço.</span>
              <button type="button" className="text-button" onClick={retry}>
                Tentar novamente
              </button>
            </div>
          )}
          {catalog &&
            (catalog.demoData ||
              catalog.knowledge.demoDocuments > 0 ||
              catalog.mode === 'demo') && (
              <div className="demo-banner">
                <span className="demo-tag">DEMONSTRAÇÃO</span>
                <p>
                  {catalog.demoData
                    ? 'O catálogo inclui clínicas fictícias. '
                    : 'Catálogo com fontes públicas ou cadastros importados. '}
                  {catalog.mode === 'demo'
                    ? 'Respostas locais para testar o fluxo, sem IA generativa.'
                    : catalog.knowledge.demoDocuments > 0
                      ? 'IA generativa com base de homologação, ainda sem revisão clínica.'
                      : 'Confira as fontes da orientação.'}
                </p>
              </div>
            )}
          {catalog && (!catalog.knowledge.indexedDocuments || catalog.knowledge.needsReindex) && (
            <div className="notice error-notice" role="status">
              A base de orientação está sendo preparada. O catálogo continua disponível para
              consulta.
            </div>
          )}
          <div hidden={view !== 'chat'}>
            <div className="workspace-grid">
              <ChatPanel
                key={session}
                catalog={catalog}
                city={city}
                insurance={insurance}
                onCityChange={setCity}
                onInsuranceChange={setInsurance}
              />
              <aside className="context-column" aria-label="Orientações para a conversa">
                <section className="journey-card">
                  <div className="card-heading">
                    <span className="icon-tile">
                      <Sparkles size={19} />
                    </span>
                    <span>COM VOCÊ, EM CADA PASSO</span>
                  </div>
                  <h2>
                    Do que você sente
                    <br />
                    ao cuidado que precisa.
                  </h2>
                  <ol className="journey-steps">
                    <li>
                      <span>01</span>
                      <div>
                        <h3>Conte com suas palavras</h3>
                        <p>Onde é o desconforto, quando começou e o que mudou.</p>
                      </div>
                    </li>
                    <li>
                      <span>02</span>
                      <div>
                        <h3>Entenda as possibilidades</h3>
                        <p>Uma orientação de especialidade, com as fontes utilizadas.</p>
                      </div>
                    </li>
                    <li>
                      <span>03</span>
                      <div>
                        <h3>Encontre atendimento</h3>
                        <p>Veja opções do catálogo para sua cidade e seu convênio.</p>
                      </div>
                    </li>
                  </ol>
                  <button type="button" className="text-button" onClick={() => setView('about')}>
                    Conheça o MedFinder <ArrowRight size={16} />
                  </button>
                </section>
                <section className="safety-card">
                  <ShieldCheck size={20} />
                  <div>
                    <h3>Orientação, com responsabilidade</h3>
                    <p>
                      O chat não faz diagnóstico nem substitui uma consulta. Em uma emergência no
                      Brasil, ligue <a href="tel:192">192</a>.
                    </p>
                  </div>
                </section>
                <div className="small-note">
                  <LockKeyhole size={15} />
                  <p>
                    As mensagens ficam nesta aba e não são salvas no banco do MedFinder. Evite nome
                    completo, CPF e outros dados pessoais.
                  </p>
                </div>
              </aside>
            </div>
          </div>
          {view === 'clinics' && (
            <ClinicDirectory
              catalog={catalog}
              city={city}
              insurance={insurance}
              onCityChange={setCity}
              onInsuranceChange={setInsurance}
            />
          )}
          {view === 'about' && (
            <section className="about-panel">
              <span className="icon-tile">
                <BookOpen size={22} />
              </span>
              <h2>Uma ponte até o atendimento.</h2>
              <p>
                O MedFinder usa seu relato para consultar uma base de informações e explicar quais
                especialidades podem ajudar na avaliação. As fontes da orientação ficam disponíveis
                em cada resposta.
              </p>
              <div className="about-grid">
                <article>
                  <span>01 / CONTEXTO</span>
                  <h3>Você conta, a conversa continua</h3>
                  <p>
                    Descreva o desconforto e responda às perguntas. Selecione cidade e convênio para
                    filtrar o catálogo.
                  </p>
                </article>
                <article>
                  <span>02 / INFORMAÇÃO</span>
                  <h3>Fontes para consultar</h3>
                  <p>
                    Quando não há informação suficiente, o assistente pede mais contexto. Uma
                    indicação não confirma uma doença.
                  </p>
                </article>
                <article>
                  <span>03 / ATENDIMENTO</span>
                  <h3>Você escolhe o próximo passo</h3>
                  <p>
                    Confirme diretamente com a clínica a cobertura do seu plano, valores e horários.
                    O MedFinder não realiza agendamentos.
                  </p>
                </article>
              </div>
              <details className="privacy-details">
                <summary>Como suas informações são utilizadas</summary>
                <p>
                  Não é necessário criar uma conta. O texto é processado para responder à conversa,
                  sem histórico no banco do MedFinder. Ao recarregar a página ou iniciar uma nova
                  conversa, as mensagens são removidas desta aba. No modo Ollama, a geração e a
                  busca na base são processadas no computador que executa o servidor MedFinder, sem
                  envio à OpenAI. No modo OpenAI, após sua autorização, o relato e mensagens
                  recentes são enviados à OpenAI para gerar a resposta. Esse provedor tem suas
                  próprias regras de tratamento e retenção de dados. A remoção da conversa nesta aba
                  não apaga eventuais registros do provedor.
                </p>
              </details>
              <p className="about-disclaimer">
                Esta versão não é um dispositivo de diagnóstico ou triagem validada. A detecção de
                alertas é limitada e pode falhar. Os resumos de orientação precisam de revisão
                clínica antes do uso com pacientes. Confirme os dados de atendimento com a clínica.
              </p>
              <button className="primary-button" type="button" onClick={() => setView('chat')}>
                Iniciar conversa <ArrowRight size={17} />
              </button>
            </section>
          )}
          <footer className="page-footer">
            <span>
              MedFinder <span aria-hidden="true">·</span> Cuidar começa por encontrar.
            </span>
            <button type="button" onClick={() => setView('about')}>
              Sobre e privacidade
            </button>
          </footer>
        </main>
      </div>
    </div>
  );
}
