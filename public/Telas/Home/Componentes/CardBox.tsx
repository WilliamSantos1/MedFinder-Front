interface CardBoxProps {
  title: string;
  description: string;
  number:number;
}

const CardBox = ({ title, description, number }: CardBoxProps) => {
  return (
    <div className="flex flex-1 flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
     <div className="flex gap-2">
       <h3 className="text-lg font-semibold text-secondary">
        {number}
      </h3>
      <h3 className="text-lg font-semibold text-gray-800">
        {title}
      </h3>
     </div>

      <p className="mt-2 text-sm text-gray-500">
        {description}
      </p>
    </div>
  );
};

export default CardBox;