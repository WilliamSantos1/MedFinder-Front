
import { useEffect, useRef, useState } from "react";

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
  const [textVisible, setTextVisible] = useState(true);

  const isResettingLoop = useRef(false);

  useEffect(() => {
    if (items.length <= 1) return;

    const timeout = setTimeout(() => {
      setCurrentIndex((current) => {
        if (current >= items.length) {
          return 0;
        }

        return current + 1;
      });
    }, 7000);

    return () => clearTimeout(timeout);
  }, [currentIndex, items.length]);

  // Animação do texto
  useEffect(() => {
    if (isResettingLoop.current) {
      isResettingLoop.current = false;
      return;
    }

    setTextVisible(false);

    const timeout = setTimeout(() => {
      setTextVisible(true);
    }, 500);

    return () => clearTimeout(timeout);
  }, [currentIndex]);

  if (items.length === 0) {
    return null;
  }

  const slides = [...items, items[0]];

  const handleTransitionEnd = () => {
    if (currentIndex === items.length) {
      isResettingLoop.current = true;

      setEnableTransition(false);
      setCurrentIndex(0);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setEnableTransition(true);
        });
      });
    }
  };

  return (
    <div className="relative h-[35vh] w-full overflow-hidden sm:h-[40vh] md:h-[50vh]">
      <div
        className={`flex h-full w-full ${
          enableTransition
            ? "transition-transform duration-700 ease-in-out"
            : ""
        }`}
        style={{
          transform: `translate3d(-${currentIndex * 100}%, 0, 0)`,
        }}
        onTransitionEnd={handleTransitionEnd}
      >
        {slides.map((item, index) => (
          <div
            key={index}
            className="relative h-full w-full min-w-full shrink-0"
          >
            <img
              src={item.image}
              alt={item.text}
              className="block h-full w-full object-cover"
            />

            <div
              className="
                absolute
                right-0
                top-1/2
                flex
                w-[70%]
                -translate-y-1/2
                items-center
                justify-center
                bg-gradient-to-l
                from-black/70
                to-transparent
                p-3
                sm:w-[55%]
                sm:p-4
                md:h-[10vh]
                md:w-[40%]
              "
            >
              <h3
                className={`
                  text-center
                  text-sm
                  font-semibold
                  text-white
                  sm:text-base
                  md:text-lg
                  transition-all
                  duration-700
                  ease-out
                  ${
                    textVisible
                      ? "translate-y-0 opacity-100"
                      : "-translate-y-10 opacity-0"
                  }
                `}
              >
                {item.text}
              </h3>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Carousel;
