import { useEffect, useState } from "react";
import { create } from "zustand";
import { AlertTriangle } from "lucide-react";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";

interface ConfirmRequest {
  title: string;
  message: string;
  /** Second paragraph in the muted colour (what the action costs). */
  detail?: string;
  confirmLabel?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
  /** One OK button: a notice rather than a question. */
  alert?: boolean;
}

interface ConfirmState {
  request: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null;
}

const useConfirmStore = create<ConfirmState>(() => ({ request: null }));

/**
 * In-app replacement for the OS confirm box, so destructive prompts match the
 * app's dialogs. Resolves true on confirm, false on cancel, Escape or a
 * backdrop click. A second request while one is open cancels the first.
 */
export function askConfirm(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().request?.resolve(false);
    useConfirmStore.setState({ request: { ...request, resolve } });
  });
}

export function showNotice(title: string, message: string): Promise<void> {
  return askConfirm({ title, message, alert: true }).then(() => undefined);
}

/** Mounted once at the app root. */
export function ConfirmHost() {
  const request = useConfirmStore((s) => s.request);
  // Keep the last request on screen while the dialog animates out.
  const [shown, setShown] = useState(request);
  useEffect(() => {
    if (request) setShown(request);
  }, [request]);

  const settle = (ok: boolean) => {
    request?.resolve(ok);
    useConfirmStore.setState({ request: null });
  };

  return (
    <Dialog open={Boolean(request)} onClose={() => settle(false)} title={shown?.title} widthClass="max-w-sm">
      {shown && (
        <div className="px-5 pb-5 flex flex-col gap-4">
          <div className="flex gap-3">
            {shown.danger && (
              <div className="shrink-0 w-9 h-9 rounded-full bg-danger/12 text-danger flex items-center justify-center">
                <AlertTriangle className="w-4.5 h-4.5" />
              </div>
            )}
            <div className="flex flex-col gap-2 text-sm min-w-0">
              <p className="break-words">{shown.message}</p>
              {shown.detail && <p className="text-muted">{shown.detail}</p>}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            {!shown.alert && (
              <Button variant="secondary" onClick={() => settle(false)}>
                Cancel
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => settle(true)}
              className={shown.danger ? "bg-danger! hover:bg-danger/85! text-white! shadow-none!" : ""}
            >
              {shown.confirmLabel ?? (shown.alert ? "OK" : "Confirm")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
