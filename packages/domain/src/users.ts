import { z } from "zod";
import { prisma } from "@project/db";
import { ApiError } from "./errors";
import { string } from "zod/v4";
import { createHash } from "crypto";

export const CreateUser = z.object({
  name: z.string(),
  password: z.string(),
  email: z.string(),
  phone: z.string(),
});
export type CreateUserInput = z.infer<typeof CreateUser>;


const userSummary = {
  id: true,
  name: true,
  email: true,
  phone: true,
  createdAt: true
} as const;

function hashNode(text: string): string{
    return createHash("sha256").update(text,"utf-8").digest("hex");
}

export async function createUser(input: CreateUserInput) {
    let passwordHash: string = hashNode(input.password);
    
    return prisma.user.create({
    data: {
      name: input.name,
      passwordHash: passwordHash,
      email: input.email,
      phone: input.phone,
    },
    select: userSummary,
  });
}
