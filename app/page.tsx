import { Library } from "@/components/Library";

// The Library grid (SPEC §6.1, T-05). AddPhotoButton now lives inside
// Library — both the empty-state and the sticky bottom-bar placements.
export default function Home() {
  return <Library />;
}
