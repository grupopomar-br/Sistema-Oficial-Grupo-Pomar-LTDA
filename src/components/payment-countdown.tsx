"use client";

import { useEffect, useState } from "react";

// The ticking clock updates this small text, not the form, QR and whole checkout.
export default function PaymentCountdown({ expiresAt }: { expiresAt: string }) {
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible")
        setSeconds(
          Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)),
        );
    };
    update();
    const timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [expiresAt]);
  if (seconds === null) return <>Conferindo validade</>;
  if (seconds >= 3600)
    return (
      <>
        {Math.floor(seconds / 3600)}h{" "}
        {String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}min
      </>
    );
  return (
    <>
      {String(Math.floor(seconds / 60)).padStart(2, "0")}:
      {String(seconds % 60).padStart(2, "0")}
    </>
  );
}
