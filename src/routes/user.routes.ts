import { Hono } from "hono";
import Container from "typedi";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { UserService } from "../services/user.service";
import { requireRole } from "../middleware/requireRole";

const userRoutes = new Hono();
const userService = Container.get(UserService);

// All user management routes require superadmin role
userRoutes.use("*", requireRole("superadmin"));

const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
  role: z.enum(["superadmin", "user"]).optional().default("user"),
});

const UpdateUserSchema = z.object({
  name: z.string().optional(),
  role: z.enum(["superadmin", "user"]).optional(),
  isActive: z.boolean().optional(),
});

const ResetPasswordSchema = z.object({
  password: z.string().min(8),
});

userRoutes.get("/", async (c) => {
  return c.json(await userService.findAll());
});

userRoutes.get("/:id", async (c) => {
  try {
    return c.json(await userService.findOne(c.req.param("id")));
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
  }
});

userRoutes.post("/", zValidator("json", CreateUserSchema), async (c) => {
  try {
    const data = c.req.valid("json");
    const user = await userService.create(data);
    return c.json(user, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

userRoutes.put("/:id", zValidator("json", UpdateUserSchema), async (c) => {
  try {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    return c.json(await userService.update(id, data));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

userRoutes.post(
  "/:id/reset-password",
  zValidator("json", ResetPasswordSchema),
  async (c) => {
    try {
      const id = c.req.param("id");
      const { password } = c.req.valid("json");
      await userService.resetPassword(id, password);
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  }
);

userRoutes.delete("/:id", async (c) => {
  try {
    await userService.delete(c.req.param("id"));
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

export default userRoutes;
