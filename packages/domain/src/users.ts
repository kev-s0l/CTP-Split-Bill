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

export const Login = z.object({
    email: z.string().trim().toLowerCase().email("Not a valid email address"),
    password: z.string(),
});
export type LoginInput = z.infer<typeof Login>;

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

export async function verifyLogin(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, passwordHash: true }, 
  });

  const bad = () => new ApiError("UNAUTHENTICATED", "Invalid email or password", 401);

  if (!user || !user.passwordHash) throw bad();
  if (user.passwordHash !== hashNode(input.password)) throw bad();

  return { id: user.id };
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
