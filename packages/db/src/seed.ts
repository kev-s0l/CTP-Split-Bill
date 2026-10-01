// Dev seed: two users and a little data for each, so every endpoint can be
// exercised as an owner (demo-user) and as a stranger (other-user).
// Idempotent — fixed ids + upserts, safe to run repeatedly. Run with `pnpm db:seed`
// while `pnpm dev` is up.

import { prisma } from "./client";

const DEMO = "demo-user"; // the dev identity stub's fallback — packages/auth
const OTHER = "other-user";

async function seed() {
  await prisma.user.upsert({
    where: { id: DEMO },
    update: {},
    create: { id: DEMO, name: "Demo User", email: "demo@example.com" },
  });
  await prisma.user.upsert({
    where: { id: OTHER },
    update: {},
    create: { id: OTHER, name: "Other User", email: "other@example.com" },
  });

  // demo-user's party: demo-user (organizer) + a guest, with one parsed receipt.
  await prisma.party.upsert({
    where: { id: "seed-party-demo" },
    update: {},
    create: { id: "seed-party-demo", name: "Sushi night", organizerId: DEMO },
  });
  await prisma.partyMember.upsert({
    where: { id: "seed-member-demo" },
    update: {},
    create: { id: "seed-member-demo", partyId: "seed-party-demo", userId: DEMO, displayName: "Demo User" },
  });
  await prisma.partyMember.upsert({
    where: { id: "seed-member-guest" },
    update: {},
    create: { id: "seed-member-guest", partyId: "seed-party-demo", displayName: "Sam (guest)" },
  });
  await prisma.receipt.upsert({
    where: { id: "seed-receipt-demo" },
    update: {},
    create: {
      id: "seed-receipt-demo",
      partyId: "seed-party-demo",
      uploadedById: DEMO,
      paidByMemberId: "seed-member-demo",
      status: "PARSED",
      imageBlobName: "seed/receipt-demo.jpg",
      imageContentType: "image/jpeg",
      merchantName: "Sushi Place",
      subtotal: "30.00",
      tax: "2.66",
      tip: "6.00",
      total: "38.66",
      items: {
        create: [
          { lineNumber: 1, name: "Salmon roll", quantity: 2, unitPrice: "8.00", totalPrice: "16.00" },
          { lineNumber: 2, name: "Miso soup", quantity: 1, unitPrice: "4.00", totalPrice: "4.00" },
          { lineNumber: 3, name: "Edamame", quantity: 2, unitPrice: "5.00", totalPrice: "10.00" },
        ],
      },
    },
  });

  // other-user's party: demo-user is NOT a member, so its ids must 404 for demo-user.
  await prisma.party.upsert({
    where: { id: "seed-party-other" },
    update: {},
    create: { id: "seed-party-other", name: "Other's road trip", organizerId: OTHER },
  });
  await prisma.partyMember.upsert({
    where: { id: "seed-member-other" },
    update: {},
    create: { id: "seed-member-other", partyId: "seed-party-other", userId: OTHER, displayName: "Other User" },
  });

  console.log(`seeded users ${DEMO}, ${OTHER} with one party each`);
}

seed()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
