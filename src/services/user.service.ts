import { Service } from "typedi";
import { randomUUID } from "crypto";
import { UserRepository } from "../repositories/user.repository";

@Service()
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  async create(data: { email: string; password: string; name?: string; role?: "superadmin" | "user" }) {
    const existing = await this.userRepository.findByEmail(data.email);
    if (existing) throw new Error("User with this email already exists");

    const passwordHash = await Bun.password.hash(data.password, {
      algorithm: "bcrypt",
      cost: 12,
    });

    const record = {
      id: randomUUID(),
      email: data.email,
      passwordHash,
      name: data.name ?? null,
      role: data.role ?? "user",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const created = await this.userRepository.create(record);
    const { passwordHash: _, ...safeUser } = created;
    return safeUser;
  }

  async findAll() {
    const users = await this.userRepository.findAll();
    return users.map(({ passwordHash, ...rest }) => rest);
  }

  async findOne(id: string) {
    const u = await this.userRepository.findById(id);
    if (!u) throw new Error("User not found");
    const { passwordHash, ...safe } = u;
    return safe;
  }

  async update(id: string, data: { name?: string; role?: "superadmin" | "user"; isActive?: boolean }) {
    const existing = await this.userRepository.findById(id);
    if (!existing) throw new Error("User not found");

    const updated = await this.userRepository.update(id, {
      ...data,
      updatedAt: new Date(),
    });
    const { passwordHash, ...safe } = updated;
    return safe;
  }

  async resetPassword(id: string, newPassword: string) {
    const existing = await this.userRepository.findById(id);
    if (!existing) throw new Error("User not found");

    const passwordHash = await Bun.password.hash(newPassword, {
      algorithm: "bcrypt",
      cost: 12,
    });

    await this.userRepository.update(id, {
      passwordHash,
      updatedAt: new Date(),
    });
  }

  async delete(id: string) {
    const existing = await this.userRepository.findById(id);
    if (!existing) throw new Error("User not found");
    await this.userRepository.delete(id);
  }
}
