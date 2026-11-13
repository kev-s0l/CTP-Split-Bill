// Placeholder until this step's screen lands (docs/specs/receipts/flow.md).
import { StepPlaceholder } from "../StepPlaceholder";
import { loadStep } from "../step-guard";

export const dynamic = "force-dynamic";

export default async function PicksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await loadStep(id, "picks");
  return <StepPlaceholder title="Picks" />;
}
