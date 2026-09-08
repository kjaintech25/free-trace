import { AddPhotoButton } from "@/components/AddPhotoButton";

export default function Home() {
  // The full library grid (SPEC §6.1) is built in T-05; this ticket (T-04)
  // only wires up the "+ Add photo" import flow in place of the placeholder.
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-bg text-text">
      <h1 className="font-sans text-2xl">Free Trace</h1>
      <AddPhotoButton />
    </main>
  );
}
