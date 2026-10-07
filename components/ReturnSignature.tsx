"use client";

import { useState } from "react";
import SignaturePad from "@/components/SignaturePad";

// Customer name and signature for a market return, posted with the form.
export default function ReturnSignature() {
  const [sig, setSig] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <input className="input" name="signatoryName" placeholder="Name of the person handing over the goods *" required />
      <SignaturePad onChange={setSig} />
      <input type="hidden" name="signatureDataUrl" value={sig ?? ""} />
    </div>
  );
}
