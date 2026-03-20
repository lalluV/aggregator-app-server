import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { connectDB } from "./config/db.js";
import { cleanupExpiredFeatured } from "./utils/featuredCleanup.js";

// Import routes
import userAuthRoutes from "./routes/userAuth.js";
import agencyAuthRoutes from "./routes/agencyAuth.js";
import agencyRoutes from "./routes/agencies.js";
import propertyRoutes from "./routes/properties.js";
import adminRoutes from "./routes/admin.js";
import uploadRoutes from "./routes/upload.js";
import favoriteRoutes from "./routes/favorites.js";
import countryRoutes from "./routes/countries.js";
import partnerRoutes from "./routes/partners.js";
import universityApplicationRoutes from "./routes/universityApplications.js";
import groupRoutes from "./routes/groups.js";
import directChatRoutes from "./routes/directChats.js";
import UniversityGroup from "./models/UniversityGroup.js";
import DirectChat from "./models/DirectChat.js";

// Load env variables
dotenv.config();

// Connect to database
connectDB();

// Initialize express and HTTP server
const app = express();
const httpServer = createServer(app);

// Initialize Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:8081", // React Native Metro
      "https://safeaven.com",
      "https://admin.safeaven.com",
      process.env.CORS_ORIGIN,
    ].filter(Boolean),
    credentials: true,
  },
});

// Middleware
app.use(morgan("dev"));
app.use(
  cors({
    origin: [
      "http://localhost:3000", // Web frontend
      "http://localhost:3001", // Admin panel
      "https://safeaven.com",
      "https://admin.safeaven.com",
      "https://www.safeaven.com",
      "https://www.admin.safeaven.com",
      process.env.CORS_ORIGIN,
    ].filter(Boolean),
    credentials: true,
  })
);
// Middleware - only parse JSON when Content-Type is application/json (avoid parsing multipart as JSON)
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('application/json')) {
    express.json()(req, res, next);
  } else {
    next();
  }
});
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Routes
app.get("/", (req, res) => {
  res.json({ message: "Aggregator API is running" });
});

app.use("/api/users", userAuthRoutes);
app.use("/api/agencies", agencyAuthRoutes);
app.use("/api/agencies", agencyRoutes);
app.use("/api/properties", propertyRoutes);
app.use("/api/my", propertyRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/favorites", favoriteRoutes);
app.use("/api/countries", countryRoutes);
app.use("/api/partners", partnerRoutes);
app.use("/api/university-applications", universityApplicationRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/direct-chats", directChatRoutes);

// Socket.io connection handling
const connectedUsers = new Map(); // userId -> socketId
const typingUsers = new Map(); // groupId -> Set of userIds

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Authenticate socket connection
  socket.on("authenticate", (userId) => {
    if (userId) {
      socket.userId = userId;
      connectedUsers.set(userId, socket.id);
      console.log(`User ${userId} authenticated on socket ${socket.id}`);
    }
  });

  // Join a group room
  socket.on("join_group", async (groupId, callback) => {
    try {
      if (!socket.userId) {
        if (typeof callback === "function") {
          callback({ ok: false, error: "Not authenticated" });
        }
        return;
      }
      const group = await UniversityGroup.findById(groupId).select("members isActive");
      if (!group || !group.isActive) {
        if (typeof callback === "function") {
          callback({ ok: false, error: "Group not found" });
        }
        return;
      }
      const isMember = group.members.some(
        (memberId) => memberId.toString() === socket.userId
      );
      if (!isMember) {
        if (typeof callback === "function") {
          callback({ ok: false, error: "Not a group member" });
        }
        return;
      }

      socket.join(`group_${groupId}`);
      if (typeof callback === "function") {
        callback({ ok: true });
      }
      console.log(`Socket ${socket.id} joined group_${groupId}`);
    } catch (error) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Failed to join group" });
      }
    }
  });

  // Leave a group room
  socket.on("leave_group", (groupId) => {
    socket.leave(`group_${groupId}`);
    console.log(`Socket ${socket.id} left group_${groupId}`);
  });

  // Handle new message
  socket.on("send_message", async (data, callback) => {
    try {
      const { groupId, message } = data || {};
      if (!socket.userId || !groupId || !message) {
        if (typeof callback === "function") {
          callback({ ok: false, error: "Invalid payload" });
        }
        return;
      }

      const group = await UniversityGroup.findById(groupId).select("members isActive");
      if (!group || !group.isActive) {
        if (typeof callback === "function") {
          callback({ ok: false, error: "Group not found" });
        }
        return;
      }
      const isMember = group.members.some(
        (memberId) => memberId.toString() === socket.userId
      );
      if (!isMember) {
        if (typeof callback === "function") {
          callback({ ok: false, error: "Not a group member" });
        }
        return;
      }

      // Message payload is relayed only; no server-side persistence.
      io.to(`group_${groupId}`).emit("new_message", message);
      if (typeof callback === "function") {
        callback({ ok: true });
      }
    } catch (error) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Failed to relay message" });
      }
    }
  });

  // Handle message edit
  socket.on("edit_message", (data) => {
    const { groupId, message } = data;
    io.to(`group_${groupId}`).emit("message_edited", message);
  });

  // Handle message delete
  socket.on("delete_message", (data) => {
    const { groupId, messageId } = data;
    io.to(`group_${groupId}`).emit("message_deleted", { messageId });
  });

  // Handle reaction
  socket.on("add_reaction", (data) => {
    const { groupId, messageId, reaction } = data;
    io.to(`group_${groupId}`).emit("reaction_added", { messageId, reaction });
  });

  // Join direct chat room
  socket.on("join_direct_chat", async (chatId, callback) => {
    try {
      if (!socket.userId) {
        if (typeof callback === "function") {
          callback({ ok: false, error: "Not authenticated" });
        }
        return;
      }

      const chat = await DirectChat.findById(chatId).select("participants");
      if (!chat) {
        if (typeof callback === "function") {
          callback({ ok: false, error: "Chat not found" });
        }
        return;
      }
      const isParticipant = chat.participants.some(
        (participantId) => participantId.toString() === socket.userId
      );
      if (!isParticipant) {
        if (typeof callback === "function") {
          callback({ ok: false, error: "Not a participant" });
        }
        return;
      }

      socket.join(`direct_${chatId}`);
      if (typeof callback === "function") {
        callback({ ok: true });
      }
    } catch (error) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Failed to join direct chat" });
      }
    }
  });

  socket.on("leave_direct_chat", (chatId) => {
    socket.leave(`direct_${chatId}`);
  });

  // Relay direct message without persistence
  socket.on("send_direct_message", async (data, callback) => {
    try {
      const { chatId, message } = data || {};
      if (!socket.userId || !chatId || !message) {
        if (typeof callback === "function") {
          callback({ ok: false, error: "Invalid payload" });
        }
        return;
      }

      const chat = await DirectChat.findById(chatId).select("participants");
      if (!chat) {
        if (typeof callback === "function") {
          callback({ ok: false, error: "Chat not found" });
        }
        return;
      }
      const isParticipant = chat.participants.some(
        (participantId) => participantId.toString() === socket.userId
      );
      if (!isParticipant) {
        if (typeof callback === "function") {
          callback({ ok: false, error: "Not a participant" });
        }
        return;
      }

      io.to(`direct_${chatId}`).emit("new_direct_message", message);
      if (typeof callback === "function") {
        callback({ ok: true });
      }
    } catch (error) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Failed to relay direct message" });
      }
    }
  });

  // Handle typing indicator
  socket.on("typing_start", (data) => {
    const { groupId, userId, userName } = data;
    if (!typingUsers.has(groupId)) {
      typingUsers.set(groupId, new Set());
    }
    typingUsers.get(groupId).add(userId);
    
    socket.to(`group_${groupId}`).emit("user_typing", { userId, userName });
  });

  socket.on("typing_stop", (data) => {
    const { groupId, userId } = data;
    if (typingUsers.has(groupId)) {
      typingUsers.get(groupId).delete(userId);
    }
    socket.to(`group_${groupId}`).emit("user_stopped_typing", { userId });
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    if (socket.userId) {
      connectedUsers.delete(socket.userId);
      // Remove from all typing indicators
      typingUsers.forEach((users, groupId) => {
        if (users.has(socket.userId)) {
          users.delete(socket.userId);
          io.to(`group_${groupId}`).emit("user_stopped_typing", { userId: socket.userId });
        }
      });
    }
    console.log("Client disconnected:", socket.id);
  });
});

// Make io accessible to routes
app.set("io", io);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

// Start server
const PORT = process.env.PORT || 3005;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Socket.io server ready for real-time chat`);

  // Run cleanup on startup
  cleanupExpiredFeatured().catch(console.error);

  // Run cleanup every 12 hours
  setInterval(() => {
    cleanupExpiredFeatured().catch(console.error);
  }, 12 * 60 * 60 * 1000); // 12 hours in milliseconds
});
