
export interface ChatMessage {
  id: number;
  sender: "user" | "ai";
  text: string;
}

export const mockInitialMessages: ChatMessage[] = [
  {
    id: 1,
    sender: "ai",
    text: "Olá! Sou o assistente do MedFinder. Como posso ajudar você?",
  },
];

export const mockResponses: Record<string, string> = {
  febre:
    "A febre pode estar relacionada a diferentes condições. Para uma avaliação adequada, é importante observar outros sintomas, como dor, tosse, cansaço ou dificuldade para respirar.",

  dor:
    "Entendi. Para ajudar a identificar o atendimento mais adequado, você pode me informar onde está a dor, há quanto tempo ela começou e qual é a intensidade?",

  tosse:
    "A tosse pode ter diversas causas. Você também está apresentando febre, falta de ar, dor no peito ou algum outro sintoma?",

  "dor de cabeça":
    "Dor de cabeça pode ter várias causas. Caso seja intensa, súbita ou acompanhada de outros sintomas importantes, procure atendimento médico.",

  default:
    "Entendi. Para que eu possa ajudar melhor, descreva seus sintomas com o máximo de detalhes possível, como quando começaram e quais regiões do corpo estão afetadas.",
};

export const getMockResponse = (message: string): string => {
  const normalizedMessage = message.toLowerCase();

  const matchedKey = Object.keys(mockResponses).find((key) =>
    normalizedMessage.includes(key),
  );

  return mockResponses[matchedKey ?? "default"];
};
