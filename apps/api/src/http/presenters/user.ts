import type { User } from "../../domain/users/types";

export interface UserJson {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
}

export function presentUser(user: User): UserJson {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: new Date(user.createdAt).toISOString(),
  };
}
