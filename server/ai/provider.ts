import type { ModelAnswer, Specialty } from '../../shared/contracts.js';
import type { PatientProfile } from '../domain/patient.js';

export const EMBEDDING_DIMENSIONS = 1536;
export interface AIProvider {
  mode: 'demo' | 'openai' | 'ollama';
  embeddingDimensions: number;
  embeddingModel: string;
  checkAvailability?(): Promise<void>;
  embed(texts: string[]): Promise<number[][]>;
  generate(input: {
    message: string;
    history: string[];
    specialties?: Specialty[];
    previousQuestions?: string[];
    patient?: PatientProfile;
  }): Promise<ModelAnswer>;
}

export function vectorLiteral(embedding: number[], dimensions = EMBEDDING_DIMENSIONS) {
  if (
    !Array.isArray(embedding) ||
    embedding.length !== dimensions ||
    embedding.some((n) => !Number.isFinite(n)) ||
    embedding.every((n) => n === 0)
  ) {
    throw new Error(
      'Embedding inválido ou incompatível. Reindexe a base com o modelo configurado.',
    );
  }
  return `[${embedding.join(',')}]`;
}
