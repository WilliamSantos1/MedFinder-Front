import { createHash } from 'node:crypto';
import { normalize, tokens } from '../domain/text.js';
import { routeComplaint } from '../domain/specialty-routing.js';
import { patientProfile } from '../domain/patient.js';
import { EMBEDDING_DIMENSIONS, type AIProvider } from './provider.js';

// Offline deterministic adapter used by tests/demo. It never represents clinical inference.
export const demoProvider: AIProvider = {
  mode: 'demo',
  embeddingDimensions: EMBEDDING_DIMENSIONS,
  embeddingModel: 'demo-feature-hash-v2:1536',

  async embed(texts) {
    return texts.map((text) => {
      const values = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      for (const word of tokens(text)) {
        const hash = createHash('sha256').update(word).digest();
        values[hash.readUInt32BE(0) % values.length] += 1;
      }
      if (!values.some((value) => value !== 0)) values[0] = 1;
      const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
      return values.map((value) => value / norm);
    });
  },

  async generate({ message, history, specialties = [], patient: reportedPatient }) {
    const messages = [...history, message];
    const patient = reportedPatient ?? patientProfile(messages);
    const routing = routeComplaint(messages, patient);
    const allowed = new Map(specialties.map((specialty) => [specialty.id, specialty.name]));
    const selected = [
      ...routing.candidates.map((candidate) => candidate.id),
      routing.fallbackId,
    ].find((id) => allowed.has(id));

    // Tiny semantic fallbacks for ambiguous demo-only examples.
    const text = normalize(messages.join(' '));
    const semanticId =
      /\b(tontura|vertigem)\b/.test(text) && allowed.has('neurologia')
        ? 'neurologia'
        : /\b(ansiedade|depressao|panico|insonia)\b/.test(text) && allowed.has('psiquiatria')
          ? 'psiquiatria'
          : selected;
    const name = semanticId ? allowed.get(semanticId) ?? null : null;

    return {
      urgency: name ? 'routine' : 'uncertain',
      specialty: name ? { name } : null,
      questions: [],
    };
  },
};
