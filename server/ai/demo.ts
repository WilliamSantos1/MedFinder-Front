import { createHash } from 'node:crypto';
import { specialties } from '../../shared/contracts.js';
import { tokens } from '../domain/text.js';
import { EMBEDDING_DIMENSIONS, type AIProvider } from './provider.js';

// Feature hashing is an offline test adapter, NOT a semantic language model.
export const demoProvider: AIProvider = {
  mode: 'demo',
  embeddingDimensions: EMBEDDING_DIMENSIONS,
  embeddingModel: 'demo-feature-hash-v1:1536',
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
  async generate({ evidence }) {
    const first = evidence[0];
    if (!first) throw new Error('Evidência ausente.');
    const specialtyIds = first.specialties.slice(0, 2);
    return {
      answer: `Para começar, você pode buscar uma avaliação em ${specialties[specialtyIds[0]]}. ${first.content} A indicação depende de uma avaliação presencial; esta conversa não estabelece um diagnóstico.`,
      urgency: 'routine',
      specialtyIds,
      questions: [
        'Há quanto tempo isso começou e qual é a intensidade?',
        'Existe algum outro sintoma ou houve uma lesão recente?',
      ],
      sourceIds: [first.id],
    };
  },
};
