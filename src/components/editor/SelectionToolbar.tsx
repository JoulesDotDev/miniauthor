import type { MouseEvent as ReactMouseEvent } from "react";
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  Pilcrow,
} from "lucide-react";

interface SelectionToolbarProps {
  visible: boolean;
  onBold: () => void;
  onItalic: () => void;
  onHeading1: () => void;
  onHeading2: () => void;
  onParagraph: () => void;
}

export function SelectionToolbar({
  visible,
  onBold,
  onItalic,
  onHeading1,
  onHeading2,
  onParagraph,
}: SelectionToolbarProps) {
  if (!visible) {
    return null;
  }

  const buttonProps = {
    type: "button" as const,
    onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
    },
  };

  return (
    <div className="selection-toolbar" role="toolbar" aria-label="Text formatting">
      <button {...buttonProps} onClick={onBold} title="Bold" aria-label="Bold">
        <Bold size={16} />
      </button>
      <button {...buttonProps} onClick={onItalic} title="Italic" aria-label="Italic">
        <Italic size={16} />
      </button>
      <span className="selection-toolbar-sep" />
      <button {...buttonProps} onClick={onHeading1} title="Heading 1" aria-label="Heading 1">
        <Heading2 size={16} />
      </button>
      <button {...buttonProps} onClick={onHeading2} title="Heading 2" aria-label="Heading 2">
        <Heading3 size={16} />
      </button>
      <button {...buttonProps} onClick={onParagraph} title="Paragraph" aria-label="Paragraph">
        <Pilcrow size={16} />
      </button>
    </div>
  );
}
