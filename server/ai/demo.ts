import { createHash } from 'node:crypto';
import { normalize, tokens } from '../domain/text.js';
import { EMBEDDING_DIMENSIONS, type AIProvider } from './provider.js';
import { assessDetail } from '../domain/clarification.js';
import { patientProfile } from '../domain/patient.js';

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
  async generate({ message, history, patient: reportedPatient }) {
    // Synthetic examples for interface/integration checks, never a clinical inference engine.
    const text = normalize([...history, message].join(' '));
    const assessment = assessDetail([...history, message]);
    const patient = reportedPatient ?? patientProfile([...history, message]);
    const name =
      !assessment.sufficient || patient.needsAge
        ? null
        : /ouvido|garganta|rouquidao/.test(text)
          ? 'Otorrinolaringologia'
          : /pele|coceira|cocando|manchas/.test(text) &&
              patient.ageYears !== null &&
              patient.ageYears < 18
            ? 'Pediatria'
            : /urinar|urinaria/.test(text)
              ? 'Urologia'
              : /pescoco|costas|lombar/.test(text)
                ? 'Ortopedia'
                : /pele|coceira|cocando|manchas/.test(text)
                  ? 'Dermatologia'
                  : /cabeca/.test(text)
                    ? 'Neurologia'
                    : /ouvido/.test(text)
                      ? 'Otorrinolaringologia'
                      : /estomago/.test(text)
                        ? 'Gastroenterologia'
                        : /olhos?/.test(text)
                          ? 'Oftalmologia'
                          : /ansiedade/.test(text)
                            ? 'Psicologia'
                            : null;
    return {
      answer: name
        ? `Exemplo demonstrativo: uma avaliação em ${name} pode ajudar a orientar o próximo passo. A indicação precisa ser avaliada por um profissional.`
        : 'Descreva melhor o desconforto para continuar a demonstração. Se precisar de atendimento, procure uma unidade de saúde.',
      urgency: name ? 'routine' : 'uncertain',
      specialty: name
        ? { name, reason: 'Associação fictícia para testar o fluxo; não é uma avaliação clínica.' }
        : null,
      questions: name ? [] : patient.needsAge ? ['age_group'] : assessment.missing.slice(0, 2),
    };
  },
};
