import "./loadEnv.js";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
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
import purchasesRoutes, { handleWebhook } from "./routes/purchases.js";
import UniversityGroup from "./models/UniversityGroup.js";
import DirectChat from "./models/DirectChat.js";
import DirectMessage from "./models/DirectMessage.js";
import ChatMessage from "./models/ChatMessage.js";
import User from "./models/User.js";
import {
  initFirebase,
  sendPushNotifications,
  isFirebaseReady,
} from "./utils/firebase.js";

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
// Stripe webhook - MUST be before JSON parser to receive raw body for signature verification
app.post(
  "/api/purchases/webhook",
  express.raw({ type: "application/json" }),
  handleWebhook
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
app.use("/api/purchases", purchasesRoutes);

// Socket.io connection handling
const connectedUsers = new Map(); // userId -> socketId
const typingUsers = new Map(); // groupId -> Set of userIds

// Push notification helpers — run async, never block the socket handler
async function pushToOfflineGroupMembers(groupId, senderId, message) {
  try {
    const group =
      await UniversityGroup.findById(groupId).select("members name");
    if (!group) return;

    const offlineMembers = group.members
      .map((id) => id.toString())
      .filter((id) => id !== senderId && !connectedUsers.has(id));
    if (offlineMembers.length === 0) return;

    const users = await User.find(
      { _id: { $in: offlineMembers }, "fcmTokens.0": { $exists: true } },
      { fcmTokens: 1 },
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
      data: {
        type: "group",
        groupId,
        groupName: group.name || "",
        messagePayload: JSON.stringify(message),
      },
    });

    if (result.failedTokens.length > 0) {
      await User.updateMany(
        { "fcmTokens.token": { $in: result.failedTokens } },
        { $pull: { fcmTokens: { token: { $in: result.failedTokens } } } },
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
      { fcmTokens: 1 },
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
        messagePayload: JSON.stringify(message),
      },
    });

    if (result.failedTokens.length > 0) {
      await User.updateMany(
        { "fcmTokens.token": { $in: result.failedTokens } },
        { $pull: { fcmTokens: { token: { $in: result.failedTokens } } } },
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

  // Group message — relay + persist to MongoDB
  socket.on("send_message", async (data, callback) => {
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

    const localId = message._id;
    let savedMessage = message;

    try {
      const mt = message.messageType || "text";
      const senderId = message.sender?._id || socket.userId;
      const createPayload = {
        group: groupId,
        sender: senderId,
        messageType: mt,
        reactions: [],
        mentions: [],
        isEdited: !!message.isEdited,
        isDeleted: !!message.isDeleted,
        createdAt: message.createdAt ? new Date(message.createdAt) : new Date(),
      };

      if (mt === "text") {
        createPayload.content = message.content ?? "";
      } else if (mt === "image" || mt === "file") {
        createPayload.mediaUrl =
          message.mediaUrl || message.mediaUrls?.[0] || undefined;
        if (message.content) {
          createPayload.content = message.content;
        }
      }

      if (
        message.replyTo?._id &&
        /^[0-9a-f]{24}$/i.test(String(message.replyTo._id))
      ) {
        createPayload.replyTo = message.replyTo._id;
      }

      const doc = await ChatMessage.create(createPayload);

      savedMessage = {
        ...message,
        _id: doc._id.toString(),
        localId,
        group: groupId,
        sender: message.sender || { _id: senderId },
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt
          ? doc.updatedAt.toISOString()
          : doc.createdAt.toISOString(),
      };
    } catch (err) {
      console.error("Failed to persist group message:", err.message);
      savedMessage = { ...message, group: groupId };
    }

    io.to(roomName).emit("new_message", savedMessage);
    const room = io.sockets.adapter.rooms.get(roomName);
    if (room && room.size > 1 && savedMessage?._id) {
      socket.emit("group_message_delivered", {
        groupId,
        messageId: savedMessage._id,
      });
    }
    if (typeof callback === "function") {
      callback({ ok: true, messageId: savedMessage._id });
    }

    if (isFirebaseReady()) {
      pushToOfflineGroupMembers(groupId, socket.userId, savedMessage);
    }
  });

  // Handle message edit
  socket.on("edit_message", (data) => {
    const { groupId, message } = data;
    io.to(`group_${groupId}`).emit("message_edited", message);
  });

  // Handle message delete (soft-delete in DB + broadcast)
  socket.on("delete_message", async (data, callback) => {
    const { groupId, messageId } = data || {};
    if (!socket.userId || !groupId || !messageId) {
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
    const mid = String(messageId);
    if (!/^[0-9a-f]{24}$/i.test(mid)) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Invalid message id" });
      }
      return;
    }
    try {
      const msg = await ChatMessage.findOne({
        _id: mid,
        group: groupId,
      });
      if (!msg) {
        if (typeof callback === "function") {
          callback({ ok: false, error: "Message not found" });
        }
        return;
      }
      if (msg.sender.toString() !== socket.userId) {
        if (typeof callback === "function") {
          callback({ ok: false, error: "Not allowed" });
        }
        return;
      }
      msg.isDeleted = true;
      msg.content = "This message has been deleted";
      msg.messageType = "text";
      msg.mediaUrl = undefined;
      msg.fileName = undefined;
      await msg.save();
      io.to(roomName).emit("message_deleted", {
        groupId,
        messageId: msg._id.toString(),
      });
      if (typeof callback === "function") {
        callback({ ok: true });
      }
    } catch (err) {
      console.error("delete_message:", err.message);
      if (typeof callback === "function") {
        callback({ ok: false, error: "Failed to delete message" });
      }
    }
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

  // Relay direct message and persist to DB
  socket.on("send_direct_message", async (data, callback) => {
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

    const localId = message._id;

    // Persist to DB (fire-and-forget for speed, but attach the real _id to the broadcast)
    let savedMessage = message;
    let persistedMessageId = null;
    try {
      const userType = message.sender?.type === "Agency" ? "Agency" : "User";
      const doc = await DirectMessage.create({
        directChat: chatId,
        sender: message.sender?._id || socket.userId,
        senderModel: userType,
        messageType: message.messageType || "text",
        content: message.content || undefined,
        mediaUrl: message.mediaUrl || undefined,
        replyTo:
          message.replyTo?._id && /^[0-9a-f]{24}$/i.test(message.replyTo._id)
            ? message.replyTo._id
            : undefined,
        createdAt: message.createdAt || new Date(),
      });

      persistedMessageId = doc._id;
      savedMessage = {
        ...message,
        _id: doc._id.toString(),
        localId,
        directChat: chatId,
        createdAt: doc.createdAt.toISOString(),
      };

      DirectChat.findByIdAndUpdate(chatId, {
        lastMessageAt: doc.createdAt,
      }).catch(() => {});
    } catch (err) {
      console.error("Failed to persist direct message:", err.message);
      savedMessage = { ...message, localId, directChat: chatId };
    }

    io.to(roomName).emit("new_direct_message", savedMessage);
    const room = io.sockets.adapter.rooms.get(roomName);
    if (room && room.size > 1 && savedMessage?._id) {
      socket.emit("direct_message_delivered", {
        chatId,
        messageId: savedMessage._id,
      });
      if (persistedMessageId) {
        DirectMessage.findByIdAndUpdate(persistedMessageId, {
          deliveredAt: new Date(),
        }).catch(() => {});
      }
    }
    if (typeof callback === "function") {
      callback({ ok: true, messageId: savedMessage._id });
    }

    // Push notification to offline participant (fire-and-forget)
    if (isFirebaseReady()) {
      pushToOfflineDirectRecipient(chatId, socket.userId, savedMessage);
    }
  });

  socket.on("delete_direct_message", async (data, callback) => {
    const { chatId, messageId } = data || {};
    if (!socket.userId || !chatId || !messageId) {
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
    const mid = String(messageId);
    if (!/^[0-9a-f]{24}$/i.test(mid)) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Invalid message id" });
      }
      return;
    }
    try {
      const msg = await DirectMessage.findOne({
        _id: mid,
        directChat: chatId,
      });
      if (!msg) {
        if (typeof callback === "function") {
          callback({ ok: false, error: "Message not found" });
        }
        return;
      }
      if (msg.sender.toString() !== socket.userId) {
        if (typeof callback === "function") {
          callback({ ok: false, error: "Not allowed" });
        }
        return;
      }
      msg.isDeleted = true;
      msg.content = "This message has been deleted";
      msg.messageType = "text";
      msg.mediaUrl = undefined;
      msg.fileName = undefined;
      await msg.save();
      io.to(roomName).emit("direct_message_deleted", {
        chatId,
        messageId: msg._id.toString(),
      });
      if (typeof callback === "function") {
        callback({ ok: true });
      }
    } catch (err) {
      console.error("delete_direct_message:", err.message);
      if (typeof callback === "function") {
        callback({ ok: false, error: "Failed to delete message" });
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

  socket.on("direct_messages_seen", async (data) => {
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
    const now = new Date();
    try {
      await DirectMessage.updateMany(
        {
          _id: { $in: messageIds },
          directChat: chatId,
          isDeleted: { $ne: true },
        },
        { $set: { readAt: now } },
      );
    } catch (e) {
      console.error("direct_messages_seen persist:", e.message);
    }
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
