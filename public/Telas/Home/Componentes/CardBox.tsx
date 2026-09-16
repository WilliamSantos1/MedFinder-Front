interface CardBoxProps {
  title: string;
  description: string;
}

const CardBox = ({ title, description }: CardBoxProps) => {
  return (
    <div className="flex flex-1 flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-800">
        {title}
      </h3>

      <p className="mt-2 text-sm text-gray-500">
        {description}
      </p>
    </div>
  );
};

export default CardBox;