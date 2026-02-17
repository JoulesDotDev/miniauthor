import type { MouseEvent as ReactMouseEvent } from "react";
import {
  Bold,
  Heading2,
  Italic,
  Pilcrow,
  Underline,
} from "lucide-react";

interface SelectionToolbarProps {
  visible: boolean;
  onBold: () => void;
  onItalic: () => void;
  onUnderline: () => void;
  onHeading: () => void;
  onParagraph: () => void;
}

export function SelectionToolbar({
  visible,
  onBold,
  onItalic,
  onUnderline,
  onHeading,
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
      <button {...buttonProps} onClick={onUnderline} title="Underline" aria-label="Underline">
        <Underline size={16} />
      </button>
      <span className="selection-toolbar-sep" />
      <button {...buttonProps} onClick={onHeading} title="Section headline" aria-label="Section headline">
        <Heading2 size={16} />
      </button>
      <button {...buttonProps} onClick={onParagraph} title="Paragraph" aria-label="Paragraph">
        <Pilcrow size={16} />
      </button>
    </div>
  );
}
