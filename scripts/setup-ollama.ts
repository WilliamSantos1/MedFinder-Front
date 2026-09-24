import { spawn } from 'node:child_process';
import { prepareOllamaConfig } from './local-config.js';

try {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL)
    throw new Error(
      'Use a configuração manual de Ollama em ambientes de servidor. Consulte docs/OLLAMA.md.',
    );
  const result = await prepareOllamaConfig(process.cwd());
  if (result.backup) console.log(`Configuração anterior preservada em ${result.backup}.`);
  console.log(
    result.created
      ? '.env criado automaticamente para IA local.'
      : 'Configuração Ollama existente preservada.',
  );
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'scripts/manage.ts', 'setup-ollama', ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      // Explicit mode prevents an inherited OpenAI setting from enabling a paid request.
      env: { ...process.env, AI_PROVIDER: 'ollama' },
    },
  );
  child.on('error', () => {
    console.error('Não foi possível iniciar a preparação local.');
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Não foi possível preparar o .env local.');
  process.exitCode = 1;
}
