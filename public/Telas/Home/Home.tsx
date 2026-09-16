import CardBox from "./Componentes/CardBox";
import Carousel from "./Componentes/Carousel"

const Home = ()=>{

    const carouselItems = [ 
         { image: "/Imagens/imagemCarrossel1.jpg", 
            text: "Encontre informações sobre medicamentos", },
         { image: "/Imagens/imagemCarrossel2.jpg", 
            text: "Consulte informações de forma rápida", },
         { image: "/Imagens/imagemCarrossel3.jpg", 
            text: "Tenha informações importantes na palma da mão", }, ];
   
return(
    <div className="flex flex-col gap-6 w-full items-center">

        <div className="w-full"> 
            <Carousel items={carouselItems} /> 
        </div>
     
        <p className="mb-6 text-2xl font-bold">
            Como o MedFinder funciona
        </p>

        <div className="flex w-full flex-row gap-6">
            <CardBox
            title="Infermidades"
            description="O usuário descreve seu problema de saúde."
            />

            <CardBox
            title="Analise do Problema"
            description="Nossa IA analisa o problema de saúde de forma clara e precisa."
            />

            <CardBox
            title="Indicação"
            description="Após análise, nossa IA recomenda médicos capacitados o mais próximo do usuário."
            />
        </div>
    </div>
    )
}

export default Home;