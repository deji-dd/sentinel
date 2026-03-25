import React from "react"

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'l-trefoil': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        size?: string;
        stroke?: string;
        'stroke-length'?: string;
        'bg-opacity'?: string;
        speed?: string;
        color?: string;
      }
    }
  }
}
