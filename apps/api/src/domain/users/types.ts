export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: number | null;
  authVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface EmailToken {
  id: string;
  userId: string;
  type: "VERIFY_EMAIL" | "RESET_PASSWORD";
  tokenHash: string;
  expiresAt: number;
  usedAt: number | null;
  createdAt: number;
}

export interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  revokedAt: number | null;
  replacedById: string | null;
  createdAt: number;
}
