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
import User from "./models/User.js";
import { initFirebase, sendPushNotifications, isFirebaseReady } from "./utils/firebase.js";

// Load env variables
dotenv.config();

// Connect to database
connectDB();

// Initialize Firebase for push notifications
initFirebase();

// Initialize express and HTTP server
const app = express();
const httpServer = createServer(app);

const envCorsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:8081", // React Native Metro
  "https://safeaven.com",
  "https://www.safeaven.com",
  "https://admin.safeaven.com",
  "https://www.admin.safeaven.com",
  ...envCorsOrigins,
];

// Initialize Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

// Middleware
app.use(morgan("dev"));
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);
// Middleware - only parse JSON when Content-Type is application/json (avoid parsing multipart as JSON)
app.use((req, res, next) => {
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("application/json")) {
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

// Push notification helpers — run async, never block the socket handler
async function pushToOfflineGroupMembers(groupId, senderId, message) {
  try {
    const group = await UniversityGroup.findById(groupId).select("members name");
    if (!group) return;

    const offlineMembers = group.members
      .map((id) => id.toString())
      .filter((id) => id !== senderId && !connectedUsers.has(id));
    if (offlineMembers.length === 0) return;

    const users = await User.find(
      { _id: { $in: offlineMembers }, "fcmTokens.0": { $exists: true } },
      { fcmTokens: 1 }
    ).lean();

    const tokens = users.flatMap((u) => u.fcmTokens.map((t) => t.token));
    if (tokens.length === 0) return;

    const senderName = message.sender?.name || "Someone";
    const body =
      message.messageType === "image"
        ? `${senderName} sent a photo`
        : message.content || "New message";

    const result = await sendPushNotifications(tokens, {
      title: group.name || "Group",
      body,
      data: { type: "group", groupId, groupName: group.name || "" },
    });

    if (result.failedTokens.length > 0) {
      await User.updateMany(
        { "fcmTokens.token": { $in: result.failedTokens } },
        { $pull: { fcmTokens: { token: { $in: result.failedTokens } } } }
      );
    }
  } catch (error) {
    console.error("pushToOfflineGroupMembers error:", error.message);
  }
}

async function pushToOfflineDirectRecipient(chatId, senderId, message) {
  try {
    const chat = await DirectChat.findById(chatId).select("participants");
    if (!chat) return;

    const recipientId = chat.participants
      .map((id) => id.toString())
      .find((id) => id !== senderId);
    if (!recipientId || connectedUsers.has(recipientId)) return;

    const user = await User.findOne(
      { _id: recipientId, "fcmTokens.0": { $exists: true } },
      { fcmTokens: 1 }
    ).lean();
    if (!user) return;

    const tokens = user.fcmTokens.map((t) => t.token);
    if (tokens.length === 0) return;

    const senderName = message.sender?.name || "Someone";
    const body =
      message.messageType === "image"
        ? `${senderName} sent a photo`
        : message.content || "New message";

    const result = await sendPushNotifications(tokens, {
      title: senderName,
      body,
      data: {
        type: "direct",
        chatId,
        otherUserId: senderId,
        otherUserName: senderName,
      },
    });

    if (result.failedTokens.length > 0) {
      await User.updateMany(
        { "fcmTokens.token": { $in: result.failedTokens } },
        { $pull: { fcmTokens: { token: { $in: result.failedTokens } } } }
      );
    }
  } catch (error) {
    console.error("pushToOfflineDirectRecipient error:", error.message);
  }
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Authenticate socket connection and auto-join all rooms
  socket.on("authenticate", async (userId) => {
    if (!userId) return;
    socket.userId = userId;
    connectedUsers.set(userId, socket.id);
    console.log(`User ${userId} authenticated on socket ${socket.id}`);

    try {
      const [groups, directChats] = await Promise.all([
        UniversityGroup.find({ members: userId, isActive: true }).select("_id"),
        DirectChat.find({ participants: userId }).select("_id"),
      ]);

      groups.forEach((group) => socket.join(`group_${group._id}`));
      directChats.forEach((chat) => socket.join(`direct_${chat._id}`));

      console.log(
        `Auto-joined ${groups.length} groups, ${directChats.length} direct chats for user ${userId}`,
      );
    } catch (error) {
      console.error("Error auto-joining rooms on authenticate:", error);
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
      const group =
        await UniversityGroup.findById(groupId).select("members isActive");
      if (!group || !group.isActive) {
        if (typeof callback === "function") {
          callback({ ok: false, error: "Group not found" });
        }
        return;
      }
      const isMember = group.members.some(
        (memberId) => memberId.toString() === socket.userId,
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

  // Handle new message — fast room-membership check (no DB hit)
  socket.on("send_message", (data, callback) => {
    const { groupId, message } = data || {};
    if (!socket.userId || !groupId || !message) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Invalid payload" });
      }
      return;
    }

    const roomName = `group_${groupId}`;
    if (!socket.rooms.has(roomName)) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Not in group room" });
      }
      return;
    }

    io.to(roomName).emit("new_message", message);
    const room = io.sockets.adapter.rooms.get(roomName);
    if (room && room.size > 1 && message?._id) {
      socket.emit("group_message_delivered", {
        groupId,
        messageId: message._id,
      });
    }
    if (typeof callback === "function") {
      callback({ ok: true });
    }

    // Push notifications to offline group members (fire-and-forget)
    if (isFirebaseReady()) {
      pushToOfflineGroupMembers(groupId, socket.userId, message);
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
        (participantId) => participantId.toString() === socket.userId,
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

  // Relay direct message — fast room-membership check (no DB hit)
  socket.on("send_direct_message", (data, callback) => {
    const { chatId, message } = data || {};
    if (!socket.userId || !chatId || !message) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Invalid payload" });
      }
      return;
    }

    const roomName = `direct_${chatId}`;
    if (!socket.rooms.has(roomName)) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Not in direct chat room" });
      }
      return;
    }

    io.to(roomName).emit("new_direct_message", message);
    const room = io.sockets.adapter.rooms.get(roomName);
    if (room && room.size > 1 && message?._id) {
      socket.emit("direct_message_delivered", {
        chatId,
        messageId: message._id,
      });
    }
    if (typeof callback === "function") {
      callback({ ok: true });
    }

    // Push notification to offline participant (fire-and-forget)
    if (isFirebaseReady()) {
      pushToOfflineDirectRecipient(chatId, socket.userId, message);
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

  socket.on("group_messages_seen", (data) => {
    const { groupId, messageIds } = data || {};
    if (
      !socket.userId ||
      !groupId ||
      !Array.isArray(messageIds) ||
      messageIds.length === 0
    ) {
      return;
    }
    const roomName = `group_${groupId}`;
    if (!socket.rooms.has(roomName)) return;
    socket.to(roomName).emit("group_messages_read", { groupId, messageIds });
  });

  socket.on("direct_messages_seen", (data) => {
    const { chatId, messageIds } = data || {};
    if (
      !socket.userId ||
      !chatId ||
      !Array.isArray(messageIds) ||
      messageIds.length === 0
    ) {
      return;
    }
    const roomName = `direct_${chatId}`;
    if (!socket.rooms.has(roomName)) return;
    socket.to(roomName).emit("direct_messages_read", { chatId, messageIds });
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    if (socket.userId) {
      connectedUsers.delete(socket.userId);
      // Remove from all typing indicators
      typingUsers.forEach((users, groupId) => {
        if (users.has(socket.userId)) {
          users.delete(socket.userId);
          io.to(`group_${groupId}`).emit("user_stopped_typing", {
            userId: socket.userId,
          });
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
  setInterval(
    () => {
      cleanupExpiredFeatured().catch(console.error);
    },
    12 * 60 * 60 * 1000,
  ); // 12 hours in milliseconds
});
