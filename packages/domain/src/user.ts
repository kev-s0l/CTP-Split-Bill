import { prisma } from "@project/db";
import { ApiError } from "./errors";

export async function getCurrentUser(userId: string) {
  if (typeof userId !== "string" || userId === "") {
    throw new ApiError("UNAUTHENTICATED", "Unknown user", 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      phone: true,
    },
  });
  if (!user) {
    throw new ApiError("UNAUTHENTICATED", "Unknown user", 401);
  }
  return user;
}
