import { createSignal } from "@ivlev-dev/silent-core";

export type ToastTone = "info" | "success" | "error";

const [message, setMessage] = createSignal("");
const [tone, setTone] = createSignal<ToastTone>("info");
const [open, setOpen] = createSignal(false);

let sequence = 0;

export function showToast(text: string, nextTone: ToastTone = "info"): void {
  sequence += 1;
  const current = sequence;
  setTone(nextTone);
  setMessage(text);
  setOpen(false);
  queueMicrotask(() => {
    if (current === sequence) setOpen(true);
  });
}

export function dismissToast(): void {
  setOpen(false);
}

export function toastMessage(): string {
  return message();
}

export function toastTone(): ToastTone {
  return tone();
}

export function toastOpen(): boolean {
  return open();
}
