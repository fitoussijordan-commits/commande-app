// Types minimaux de react-dom (le paquet @types/react-dom n'est pas installé) :
// seul createPortal est utilisé (fenêtres de détail rendues dans <body>).
declare module "react-dom" {
  import type { ReactNode, ReactPortal } from "react";
  export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null): ReactPortal;
}
