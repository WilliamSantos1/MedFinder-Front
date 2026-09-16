import CardBox from "./Componentes/CardBox";

const Home = ()=>{
   
return(
    <div className="flex flex-col mt-3.5 mt-6 gap-6 w-full items-center">
     
        <p className="mb-6 text-2xl font-bold">
            Como o MedFinder funciona
        </p>

        <div className="flex w-full flex-row gap-6">
            <CardBox
            title="Texto 1"
            description="descrição do texto 1"
            />

            <CardBox
            title="Texto 2"
            description="descrição do texto 2"
            />

            <CardBox
            title="Texto 3"
            description="descrição do texto 3"
            />
        </div>
    </div>
    )
}

export default Home;