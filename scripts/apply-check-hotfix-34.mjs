/**
 * Apply the MedFinder 3.4 check hotfix to an existing project without
 * overwriting other user changes. Requires no dependencies beyond Node.js.
 * Run from the project root: node .\scripts\apply-check-hotfix-34.mjs
 */
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const tasks = [
  {
    file: 'server/services/chat.ts',
    steps: [[
      'if (unresolvedAnatomy && intakeTopics.length && (conversation.care?.round ?? 0) < 3) {',
      'if (!semanticFirst && unresolvedAnatomy && intakeTopics.length && (conversation.care?.round ?? 0) < 3) {',
    ]],
  },
  {
    file: 'tests/clinical-vocabulary.test.ts',
    steps: [[
      "expect(result.deterministicId).toBe('clinica-medica');",
      'expect(result.deterministicId).toBeNull();',
    ]],
  },
  {
    file: 'tests/location-feedback.test.ts',
    steps: [
      ["import { demoProvider } from '../server/ai/demo.js';", "import { demoProvider } from '../server/ai/demo.js';\nimport { PROMPT_VERSION } from '../server/ai/prompt.js';"],
      ["prompt_version: 'care-navigation-3.3.0',", 'prompt_version: PROMPT_VERSION,'],
    ],
  },
  {
    file: 'scripts/verify-anatomical-chat.mjs',
    steps: [[
      "check(llmCalls === 0, 'Avoid unnecessary Qwen call for pure site ambiguity');",
      "check(llmCalls === 1, 'Ollama must interpret ambiguous anatomy from the first complaint');",
    ]],
  },
];

const planned = [];
for (const task of tasks) {
  const filePath = path.join(root, task.file);
  let original;
  try { original = await readFile(filePath, 'utf8'); }
  catch { throw Error(`Arquivo necessário não encontrado: ${task.file}`); }
  let revised = original;
  for (const [before, after] of task.steps) {
    // The imported-line replacement includes its old line, so distinguish
    // it from an unrelated test assertion that already happens to use `after`.
    if (after.includes(before) && revised.includes(after)) continue;
    if (!revised.includes(before)) {
      if (revised.includes(after)) continue; // already fixed
      throw Error(`Versão inesperada de ${task.file}; nenhuma alteração aplicada. Trecho esperado: ${before}`);
    }
    if (revised.indexOf(before) !== revised.lastIndexOf(before)) {
      throw Error(`Trecho ambíguo em ${task.file}; nenhuma alteração aplicada.`);
    }
    revised = revised.replace(before, after);
  }
  planned.push({ filePath, file: task.file, original, revised });
}
const changes = planned.filter((x) => x.original !== x.revised);
if (!changes.length) {
  console.log('Correção 3.4 já aplicada. Nenhum arquivo alterado.');
  process.exit(0);
}
const backupDir = path.join(root, '.medfinder-hotfix-backups', new Date().toISOString().replace(/[:.]/g, '-'));
for (const task of changes) {
  const backupPath = path.join(backupDir, task.file);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(task.filePath, backupPath);
}
for (const task of changes) {
  await writeFile(task.filePath, task.revised, 'utf8');
  console.log(`Corrigido: ${task.file}`);
}
console.log(`Backup dos arquivos anteriores: ${path.relative(root, backupDir)}`);
console.log('Execute npm.cmd run check e os verificadores de encaminhamento.');
