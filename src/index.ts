import { Hono } from "hono";
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { cors } from "hono/cors";

type Bindings = {
  DB: D1Database;
  tadpole: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(cors());

app.get("/", (c) => {
  return c.json({ message: "welcome to tadpole" });
});

// GET /users (Read)
app.get("/users", async (c) => {
  const adapter = new PrismaD1(c.env.DB);
  const prisma = new PrismaClient({ adapter });

  const cachedResponse = await c.env.tadpole.get("users");
  if (cachedResponse) {
    return new Response(cachedResponse);
  }

  const users = await prisma.user.findMany();

  const result = JSON.stringify(users);
  await c.env.tadpole.put("users", result);
  return new Response(result);
});

// GET /users/:id (Read specific user)
app.get("/users/:id", async (c) => {
  const userId = c.req.param("id");
  const cacheKey = `user:${userId}`;

  try {
    const adapter = new PrismaD1(c.env.DB);
    const prisma = new PrismaClient({ adapter });

    const cachedResponse = await c.env.tadpole.get(cacheKey);
    if (cachedResponse) {
      return c.json(JSON.parse(cachedResponse));
    }

    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId, 10) },
    });
    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const result = JSON.stringify(user);
    await c.env.tadpole.put(cacheKey, result);

    return c.json(user);
  } catch (error) {
    console.error("Error accessing KV or database:", error);
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

// POST /users (Create)
app.post("/users", async (c) => {
  const adapter = new PrismaD1(c.env.DB);
  const prisma = new PrismaClient({ adapter });

  const contentType = c.req.header("Content-Type");

  // Check if Content-Type is application/json
  if (!contentType || !contentType.includes("application/json")) {
    return c.json({ error: "Content-Type must be application/json" }, 400);
  }

  const body = await c.req.json();

  // Check if email and name are provided
  if (!body.email || !body.name) {
    return c.json({ error: "Email and name are required" }, 400);
  }

  // Check if email already exists in the database
  const existingUser = await prisma.user.findUnique({
    where: { email: body.email },
  });
  if (existingUser) {
    return c.json({ error: "Email already exists" }, 400);
  }

  const newUser = await prisma.user.create({ data: body });

  // Invalidate cache
  await c.env.tadpole.delete("users");

  return c.json(newUser);
});

// PUT /users/:id (Update)
app.put("/users/:id", async (c) => {
  const adapter = new PrismaD1(c.env.DB);
  const prisma = new PrismaClient({ adapter });
  const id = c.req.param("id");
  const contentType = c.req.header("Content-Type");

  // Check if Content-Type is application/json
  if (!contentType || !contentType.includes("application/json")) {
    return c.json({ error: "Content-Type must be application/json" }, 400);
  }

  const body = await c.req.json();

  // Check if email and name are provided
  if (!body.email || !body.name) {
    return c.json({ error: "Email and name are required" }, 400);
  }

  // Check if email is being updated
  if (body.email) {
    const existingUser = await prisma.user.findUnique({
      where: { email: body.email },
    });
    // If email exists and belongs to a different user
    if (existingUser && existingUser.id !== Number(id)) {
      return c.json({ error: "Email already exists" }, 400);
    }
  }

  const updatedUser = await prisma.user.update({
    where: { id: Number(id) },
    data: body,
  });

  // Invalidate cache
  await c.env.tadpole.delete("users");
  await c.env.tadpole.delete(`user:${id}`);

  return c.json(updatedUser);
});

// DELETE /users/:id (Delete)
app.delete("/users/:id", async (c) => {
  const adapter = new PrismaD1(c.env.DB);
  const prisma = new PrismaClient({ adapter });
  const id = c.req.param("id");

  const existingUser = await prisma.user.findUnique({
    where: { id: Number(id) },
  });
  if (!existingUser) {
    return c.json({ error: "User not found" }, 404);
  }

  const deletedUser = await prisma.user.delete({
    where: { id: Number(id) },
  });

  // Invalidate cache
  await c.env.tadpole.delete("users");
  await c.env.tadpole.delete(`user:${id}`);

  return c.json(deletedUser);
});

export default app;
