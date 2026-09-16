import { useEffect, useState } from "react";

interface CarouselItem {
  image: string;
  text: string;
}

interface CarouselProps {
  items: CarouselItem[];
}

const Carousel = ({ items }: CarouselProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [enableTransition, setEnableTransition] = useState(true);

  useEffect(() => {
    if (items.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex((current) => current + 1);
    }, 5000);

    return () => clearInterval(interval);
  }, [items.length]);

  if (items.length === 0) {
    return null;
  }

  const slides = [...items, items[0]];

  const handleTransitionEnd = () => {
    if (currentIndex === items.length) {
      // Desliga a animação
      setEnableTransition(false);

      // Volta para a primeira imagem
      setCurrentIndex(0);

      // Reativa a animação depois do reposicionamento
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setEnableTransition(true);
        });
      });
    }
  };

  return (
    <div className="relative h-[50vh] w-full overflow-hidden">
      <div
        className={`flex h-full ${
          enableTransition
            ? "transition-transform duration-700 ease-in-out"
            : ""
        }`}
        style={{
          transform: `translateX(-${currentIndex * 100}%)`,
        }}
        onTransitionEnd={handleTransitionEnd}
      >
        {slides.map((item, index) => (
          <div
            key={index}
            className="relative h-full min-w-full shrink-0"
          >
            <img
              src={item.image}
              alt={item.text}
              className="h-full w-full object-cover"
            />

            <div className="absolute bottom-0 left-0 w-full bg-black/50 p-4">
              <p className="text-center text-lg font-semibold text-white">
                {item.text}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Carousel;
