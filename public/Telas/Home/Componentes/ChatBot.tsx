
import { useEffect, useRef, useState } from "react";
import {Bot,Send,User,} from "lucide-react";

import type { ChatMessage } from "../Componentes/mockChat";
import {
  getMockResponse,
  mockInitialMessages,
} from "../Componentes/mockChat";

const ChatBot = () => {
  const [messages, setMessages] = useState<ChatMessage[]>(mockInitialMessages);

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);



  // Mantém o chat sempre na última mensagem
  const isFirstRender = useRef(true);

const messagesContainerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (isFirstRender.current) {
    isFirstRender.current = false;
    return;
  }

  const container = messagesContainerRef.current;

  if (!container) return;

  container.scrollTo({
    top: container.scrollHeight,
    behavior: "smooth",
  });
}, [messages, isLoading]);


  const handleSendMessage = () => {
    const message = input.trim();

    if (!message || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now(),
      sender: "user",
      text: message,
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setIsLoading(true);

    // Simula o tempo de resposta da IA
    setTimeout(() => {
      const aiMessage: ChatMessage = {
        id: Date.now() + 1,
        sender: "ai",
        text: getMockResponse(message),
      };

      setMessages((current) => [...current, aiMessage]);
      setIsLoading(false);
    }, 1500);
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex h-[70vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-md">
      
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-gray-200 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#004741]">
          <Bot className="h-5 w-5 text-white" />
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-800">
            Assistente MedFinder
          </h2>

          <p className="text-sm text-gray-500">
            Encontre o atendimento ideal para você
          </p>
        </div>
      </div>

      {/* Mensagens */}
      <div className="flex-1 space-y-4 overflow-y-auto bg-gray-50 p-4"
      ref={messagesContainerRef}>
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex items-end gap-2 ${
              message.sender === "user"
                ? "justify-end"
                : "justify-start"
            }`}
          >
            {/* Ícone da IA */}
            {message.sender === "ai" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#004741]">
                <Bot className="h-4 w-4 text-white" />
              </div>
            )}

            {/* Mensagem */}
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                message.sender === "user"
                  ? "rounded-br-sm bg-[#17AC91] text-white"
                  : "rounded-bl-sm bg-white text-gray-700 shadow-sm"
              }`}
            >
              {message.text}
            </div>

            {/* Ícone do usuário */}
            {message.sender === "user" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-300">
                <User className="h-4 w-4 text-gray-700" />
              </div>
            )}
          </div>
        ))}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-end gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#004741]">
              <Bot className="h-4 w-4 text-white" />
            </div>

            <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-3 shadow-sm">
              <div className="flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        <div/>
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 bg-white p-4">
        <div className="flex items-end gap-3 rounded-xl border border-gray-300 bg-gray-50 p-2 focus-within:border-[#17AC91]">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Descreva seus sintomas..."
            rows={1}
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-gray-700 outline-none placeholder:text-gray-400"
          />

          <button
            type="button"
            onClick={handleSendMessage}
            disabled={!input.trim() || isLoading}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#17AC91] text-white transition hover:bg-[#12977f] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-center text-xs text-gray-400">
          Pressione Enter para enviar
        </p>
      </div>
    </div>
  );
};

export default ChatBot;