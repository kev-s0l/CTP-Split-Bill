// Idempotent demo users, owned receipts, and receipt-local participants.
// Run pnpm db:seed while the local database is running.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "./client";

export async function seedDemo(db = prisma) {
  await db.user.upsert({
    where: { id: "demo-user" }, update: {},
    create: { id: "demo-user", name: "Demo User", email: "demo@example.com" },
  });
  await db.user.upsert({
    where: { id: "other-user" }, update: {},
    create: { id: "other-user", name: "Other User", email: "other@example.com" },
  });
  await db.receipt.upsert({
    where: { id: "seed-receipt-demo" }, update: {},
    create: {
      id: "seed-receipt-demo", ownerId: "demo-user", title: "Sushi night",
      imageBlobName: "seed/receipt-demo.jpg", imageContentType: "image/jpeg",
      parseStatus: "SUCCEEDED", merchantName: "Sushi Place",
      subtotal: "30.00", tax: "2.66", tip: "6.00", total: "38.66",
      items: { create: [
        { lineNumber: 1, name: "Salmon roll", quantity: "2", unitPrice: "8.00", totalPrice: "16.00" },
        { lineNumber: 2, name: "Miso soup", quantity: "1", unitPrice: "4.00", totalPrice: "4.00" },
        { lineNumber: 3, name: "Edamame", quantity: "2", unitPrice: "5.00", totalPrice: "10.00" },
      ] },
    },
  });
  await db.participant.upsert({
    where: { id: "seed-member-demo" }, update: {},
    create: { id: "seed-member-demo", receiptId: "seed-receipt-demo", displayName: "Demo User" },
  });
  await db.participant.upsert({
    where: { id: "seed-member-guest" }, update: {},
    create: { id: "seed-member-guest", receiptId: "seed-receipt-demo", displayName: "Sam", phone: "+12125550123" },
  });
  await db.receipt.updateMany({
    where: {
      id: "seed-receipt-demo", ownerId: "demo-user", status: "DRAFT",
      revision: 1, paidByParticipantId: null,
    },
    data: { paidByParticipantId: "seed-member-demo" },
  });
  await db.receipt.upsert({
    where: { id: "seed-receipt-other" }, update: {},
    create: {
      id: "seed-receipt-other", ownerId: "other-user", title: "Other user's receipt",
      imageBlobName: "seed/receipt-other.jpg", imageContentType: "image/jpeg",
    },
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedDemo()
    .then(() => { console.log("Seeded receipt-owned demo data"); })
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
