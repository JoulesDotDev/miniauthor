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
  active: {
    bold: boolean;
    italic: boolean;
    heading1: boolean;
    heading2: boolean;
    paragraph: boolean;
  };
  onBold: () => void;
  onItalic: () => void;
  onHeading1: () => void;
  onHeading2: () => void;
  onParagraph: () => void;
}

export function SelectionToolbar({
  visible,
  active,
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
      <button
        {...buttonProps}
        className={active.bold ? "is-active" : undefined}
        aria-pressed={active.bold}
        onClick={onBold}
        title="Bold"
        aria-label="Bold"
      >
        <Bold size={16} />
      </button>
      <button
        {...buttonProps}
        className={active.italic ? "is-active" : undefined}
        aria-pressed={active.italic}
        onClick={onItalic}
        title="Italic"
        aria-label="Italic"
      >
        <Italic size={16} />
      </button>
      <span className="selection-toolbar-sep" />
      <button
        {...buttonProps}
        className={active.heading1 ? "is-active" : undefined}
        aria-pressed={active.heading1}
        onClick={onHeading1}
        title="Heading 1"
        aria-label="Heading 1"
      >
        <Heading2 size={16} />
      </button>
      <button
        {...buttonProps}
        className={active.heading2 ? "is-active" : undefined}
        aria-pressed={active.heading2}
        onClick={onHeading2}
        title="Heading 2"
        aria-label="Heading 2"
      >
        <Heading3 size={16} />
      </button>
      <button
        {...buttonProps}
        className={active.paragraph ? "is-active" : undefined}
        aria-pressed={active.paragraph}
        onClick={onParagraph}
        title="Paragraph"
        aria-label="Paragraph"
      >
        <Pilcrow size={16} />
      </button>
    </div>
  );
}
