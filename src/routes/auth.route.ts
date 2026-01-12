import { Hono } from "hono";
import Container from "typedi";
import { zValidator } from "@hono/zod-validator";
import { AuthService } from "../services/auth.service";
import { LoginSchema, RefreshTokenSchema } from "../types/zod/auth";

const authRoutes = new Hono();
const authService = Container.get(AuthService);

authRoutes.post(
  "/login",
  zValidator("json", LoginSchema),
  async (c) => {
    try {
      const credentials = c.req.valid("json");
      console.debug("[AuthRoute] Login attempt:", credentials.email);

      const result = await authService.login(credentials);
      return c.json(result);
    } catch (err) {
      console.error("[AuthRoute] Login failed:", err);
      return c.json({ error: "Invalid email or password" }, 401);
    }
  }
);

authRoutes.post(
  "/refresh",
  zValidator("json", RefreshTokenSchema),
  async (c) => {
    try {
      const payload = c.req.valid("json");
      console.debug("[AuthRoute] Refresh token request");

      const result = await authService.refreshToken(payload.refreshToken);
      return c.json(result);
    } catch (err) {
      console.error("[AuthRoute] Refresh failed:", err);
      return c.json({ error: "Invalid refresh token" }, 401);
    }
  }
);

export default authRoutes;
