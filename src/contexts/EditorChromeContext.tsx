import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

interface EditorChromeContextValue {
  showChrome: boolean;
  toggleChrome: () => void;
  isMac: boolean;
  isMobileOS: boolean;
  menuLabel: string;
}

const EditorChromeContext = createContext<EditorChromeContextValue | null>(null);

interface EditorChromeProviderProps {
  children: ReactNode;
  showChrome: boolean;
  toggleChrome: () => void;
  isMac: boolean;
  isMobileOS: boolean;
}

export function EditorChromeProvider({
  children,
  showChrome,
  toggleChrome,
  isMac,
  isMobileOS,
}: EditorChromeProviderProps) {
  const value = useMemo<EditorChromeContextValue>(
    () => ({
      showChrome,
      toggleChrome,
      isMac,
      isMobileOS,
      menuLabel: "esc",
    }),
    [isMac, isMobileOS, showChrome, toggleChrome],
  );

  return <EditorChromeContext.Provider value={value}>{children}</EditorChromeContext.Provider>;
}

export function useEditorChrome(): EditorChromeContextValue {
  const context = useContext(EditorChromeContext);

  if (!context) {
    throw new Error("useEditorChrome must be used within an EditorChromeProvider.");
  }

  return context;
}
