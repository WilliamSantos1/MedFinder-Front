import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export async function prepareOllamaConfig(directory: string) {
  const path = join(directory, '.env');
  const current = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const env = current === null ? {} : parseEnv(current);
  if (env.NODE_ENV === 'production' || env.DATABASE_URL)
    throw new Error(
      'Configuração de servidor existente. Configure Ollama manualmente seguindo docs/OLLAMA.md.',
    );
  if (env.AI_PROVIDER === 'ollama') return { created: false, backup: null };
  const template = await readFile(join(directory, '.env.ollama.example'), 'utf8');
  const backup = current === null ? null : `.env.backup-${Date.now()}`;
  if (backup) await copyFile(path, join(directory, backup), constants.COPYFILE_EXCL);
  await writeFile(path, template, { mode: 0o600 });
  return { created: true, backup };
}
