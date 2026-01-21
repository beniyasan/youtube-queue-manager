import type { ReactNode } from "react";

export default function OverlayLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        html, body {
          background: transparent !important;
        }
        body {
          min-height: 0 !important;
        }

        @keyframes overlay-flash {
          0% {
            transform: translateY(-2px);
            filter: saturate(1.15);
            box-shadow: 0 0 0 rgba(0, 0, 0, 0);
          }
          45% {
            transform: translateY(0);
            box-shadow: 0 0 28px rgba(0, 255, 245, 0.22);
          }
          100% {
            transform: translateY(0);
            filter: saturate(1);
            box-shadow: 0 0 0 rgba(0, 0, 0, 0);
          }
        }

        .overlay-text-shadow {
          text-shadow:
            0 2px 0 rgba(0, 0, 0, 0.65),
            0 0 14px rgba(0, 0, 0, 0.75);
        }

        .overlay-flash {
          animation: overlay-flash 900ms ease-out;
        }
      `}</style>
      {children}
    </>
  );
}
