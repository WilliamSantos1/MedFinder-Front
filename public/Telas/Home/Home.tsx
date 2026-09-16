import CardBox from "./Componentes/CardBox";
import Carousel from "./Componentes/Carousel"
import ChatBot from "./Componentes/ChatBot";
const Home = ()=>{

    const carouselItems = [
         { image: "/Imagens/imagemCarrossel1.png", 
            text: "Descreva seus sintomas de forma prática", },
         { image: "/Imagens/imagemCarrossel2.png", 
            text: "Análise de informações de forma precisa", },
         { image: "/Imagens/imagemCarrossel3.png", 
            text: "Obtenha informações sobre médicos adequados aos seus sintomas", }, ];
   
return(
    <div className="flex flex-col gap-6 w-full items-center">

        <div className="w-full"> 
            <Carousel items={carouselItems} /> 
        </div>
     
        <div className="flex gap-2">
            <p className="mb-6 text-2xl font-bold text-[#9ea4ac]">
                Como
            </p>
            <p className="mb-6 text-2xl font-bold text-[#dd7a7a]">
                MedFinder
            </p>
            <p className="mb-6 text-2xl font-bold text-[#9ea4ac]">
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
        <div className="flex w-full items-center justify-center mt-auto mb-5"> 
            <button>Iniciar</button>
        </div>
        <section className="w-full px-4 py-8">
        <div className="mx-auto w-full max-w-5xl">
            <ChatBot />
        </div>
        </section>
    </div>
    )
}

export default Home;