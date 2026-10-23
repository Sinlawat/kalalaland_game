import { useEffect, useRef } from 'react';

/**
 * Opens a native <dialog> as a modal when the component mounts.
 * showModal() gives a focus trap, Escape to close and a backdrop for free.
 * Guard: StrictMode runs effects twice in development, and showModal() on a
 * dialog that is already open throws.
 */
export function useModal() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);
  return dialogRef;
}
