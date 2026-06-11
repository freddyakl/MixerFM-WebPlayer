interface MarqueeTextProps {
  text: string;
  className?: string;
  speed?: number;
}

export default function MarqueeText({ text, className = "", speed = 16 }: MarqueeTextProps) {
  return (
    <div className="w-full flex justify-center py-0.5">
      <span className={`${className} break-words text-center block w-full max-w-full leading-tight`}>
        {text}
      </span>
    </div>
  );
}
