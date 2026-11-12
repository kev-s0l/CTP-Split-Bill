// Auth.js configuration shared by the web app's route handlers and middleware.
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@project/db";
import GitHub, { type GitHubEmail } from "next-auth/providers/github";
import NextAuth from "next-auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  // The app's own sign-in card; Auth.js sends sign-in and its errors here.
  pages: { signIn: "/login", error: "/login" },
  providers: [
    GitHub({
      authorization: { params: { scope: "read:user user:email" } },
      async profile(profile, tokens) {
        const accessToken = tokens.access_token;
        if (typeof accessToken !== "string") {
          throw new Error("GitHub did not return an access token");
        }

        const response = await fetch("https://api.github.com/user/emails", {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${accessToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
        if (!response.ok) throw new Error("Could not read GitHub email settings");

        const emails = await response.json() as GitHubEmail[];
        const email = emails.find((entry) => entry.primary && entry.verified)?.email ?? null;
        return {
          id: String(profile.id),
          name: profile.name?.trim() || profile.login,
          email,
          image: profile.avatar_url,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      return typeof user.email === "string" && user.email.length > 0;
    },
    async session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
