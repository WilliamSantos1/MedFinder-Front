import CardBox from "./Componentes/CardBox";
import Carousel from "./Componentes/Carousel"
import ChatBot from "./Componentes/ChatBot";
import { useEffect, useRef, useState } from "react";

const Home = ()=>{
    const [isChatVisible, setIsChatVisible] = useState(false);

    const chatbotRef = useRef<HTMLElement>(null);

    const handleStart = () => {
    chatbotRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
    });
    };
    useEffect(() => {
    const element = chatbotRef.current;

    if (!element) return;

    const observer = new IntersectionObserver(
        ([entry]) => {
         setIsChatVisible(entry.isIntersecting);
        },
        {
            threshold: 0.2,
        },
    );

    observer.observe(element);

    return () => observer.disconnect();
    }, []);

    const carouselItems = [
         { image: "/Imagens/imagemCarrossel1.png", 
            text: "Descreva seus sintomas de forma prática", },
         { image: "/Imagens/imagemCarrossel2.png", 
            text: "Análise de informações de forma precisa", },
         { image: "/Imagens/imagemCarrossel3.png", 
            text: "Obtenha informações sobre médicos adequados aos seus sintomas", }, ];
   
return(
    <div className={`flex w-full flex-col items-center gap-6 transition-colors duration-500 ${
            isChatVisible ? "bg-background-secondary" : "bg-background"
        }`}>

        <div className="w-full"> 
            <Carousel items={carouselItems} /> 
        </div>
     
        <div className="flex gap-2">
            <p className="mb-6 text-2xl font-bold text-secondary">
                Como
            </p>
            <p className="mb-6 text-2xl font-bold text-primary">
                MedFinder
            </p>
            <p className="mb-6 text-2xl font-bold text-secondary">
                funciona
            </p>
        </div>

        <div className="flex w-full flex-row gap-6 pl-5 pr-5">
            <CardBox
            number={1}
            title="Descrição"
            description="Informe seus sintomas ou descreva o problema de 
            saúde para que o MedFinder possa ajudar a encontrar o atendimento mais adequado."
            />

            <CardBox
            number={2}
            title="Análise do problema"
            description="Nossa IA analisa os sintomas informados e 
            identifica possíveis necessidades de atendimento."
            />

            <CardBox
            number={3}
            title="Indicação"
            description="Após a análise, nossa IA recomenda os melhores profissionais e 
            serviços de saúde adequados, priorizando opções próximas ao usuário."
            />
        </div>
        <div className={`flex w-full items-center justify-center mt-10 mb-15 ${
            isChatVisible
            ? "pointer-events-none opacity-0"
            : "opacity-100"
        }`}
        > 
            <button 
            type="button" 
            onClick={handleStart} 
            className="text-white text-4xl cursor-pointer transition-transform duration-200 hover:scale-105 bg-secondary rounded-lg p-4 pl-6 pr-6" > 
                Iniciar 
            </button>
        </div>
        <section 
        className="w-full px-4 py-8"
        ref={chatbotRef}>
        <div className="mx-auto w-full max-w-5xl mb-15">
            <ChatBot />
        </div>
        </section>
    </div>
    )
}

export default Home;