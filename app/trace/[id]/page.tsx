import { TraceScreen } from "@/components/TraceScreen";

/**
 * Trace screen route (SPEC §6.3). Stays a server component so it can await
 * `params`; everything below it — the camera, the overlay, the controls and
 * the state that persists back to IndexedDB — is client-side, because
 * IndexedDB and getUserMedia only exist in the browser.
 */
export default async function TracePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <TraceScreen id={id} />;
}
