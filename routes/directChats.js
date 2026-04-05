import express from "express";
import DirectChat from "../models/DirectChat.js";
import DirectMessage from "../models/DirectMessage.js";
import User from "../models/User.js";
import Agency from "../models/Agency.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

function normalizeId(id) {
  if (id == null) return "";
  return id._id != null ? String(id._id) : String(id);
}

/** Participant who is not the current user (handles string / ObjectId mix from headers). */
function otherParticipantId(participants, currentUserId) {
  const uid = normalizeId(currentUserId).trim();
  if (!uid || !Array.isArray(participants)) return null;
  const ids = participants.map((p) => normalizeId(p));
  return ids.find((id) => id && id !== uid) || null;
}

async function resolveParticipantProfile(participantId) {
  const id = normalizeId(participantId);
  if (!id) return null;
  let doc = await User.findById(id).select("name email").lean();
  if (!doc) {
    doc = await Agency.findById(id).select("name email").lean();
  }
  if (!doc) return null;
  return { _id: doc._id, name: doc.name, email: doc.email };
}

function previewFromDirectMessage(msg, currentUserId) {
  if (!msg) {
    return {
      lastMessage: null,
      lastMessageByMe: false,
      lastMessageCreatedAt: null,
      lastMessageDeliveryStatus: null,
    };
  }
  const uid = normalizeId(currentUserId);
  let text = null;
  if (msg.messageType === "text") {
    text = msg.content || "";
  } else if (msg.messageType === "image") {
    text = "Photo";
  } else if (msg.messageType === "file") {
    text = msg.fileName || "File";
  }
  const lastMessageByMe = normalizeId(msg.sender) === uid;
  let lastMessageDeliveryStatus = null;
  if (lastMessageByMe) {
    if (msg.readAt) {
      lastMessageDeliveryStatus = "read";
    } else if (msg.deliveredAt) {
      lastMessageDeliveryStatus = "delivered";
    } else {
      lastMessageDeliveryStatus = "sent";
    }
  }
  const created = msg.createdAt
    ? new Date(msg.createdAt).toISOString()
    : null;
  return {
    lastMessage: text,
    lastMessageByMe,
    lastMessageCreatedAt: created,
    lastMessageDeliveryStatus,
  };
}

function autoJoinSocketRoom(io, userId, roomName) {
  if (!io) return;
  const sockets = io.sockets?.sockets;
  if (!sockets) return;
  for (const [, socket] of sockets) {
    if (socket.userId === userId) {
      socket.join(roomName);
    }
  }
}

// Helper to get or create direct chat between two users
async function getOrCreateDirectChat(userId, otherUserId) {
  const participants = [userId, otherUserId].sort();

  let chat = await DirectChat.findOne({
    participants: { $all: participants },
  }).populate("participants", "name email");

  if (!chat) {
    chat = await DirectChat.create({ participants });
    chat = await DirectChat.findById(chat._id).populate(
      "participants",
      "name email",
    );
  }

  return chat;
}

// GET /api/direct-chats - List my direct chats
router.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];

    const chats = await DirectChat.find({ participants: userId })
      .sort({ lastMessageAt: -1 })
      .lean();

    const chatIds = chats.map((c) => c._id);
    const lastMsgs = chatIds.length
      ? await DirectMessage.find({
          directChat: { $in: chatIds },
          isDeleted: { $ne: true },
        })
          .sort({ createdAt: -1 })
          .lean()
      : [];

    const latestByChat = new Map();
    for (const m of lastMsgs) {
      const cid = normalizeId(m.directChat);
      if (cid && !latestByChat.has(cid)) {
        latestByChat.set(cid, m);
      }
    }

    const otherIds = [
      ...new Set(
        chats
          .map((c) => otherParticipantId(c.participants, userId))
          .filter(Boolean),
      ),
    ];

    const [users, agencies] = await Promise.all([
      otherIds.length
        ? User.find({ _id: { $in: otherIds } }).select("name email").lean()
        : [],
      otherIds.length
        ? Agency.find({ _id: { $in: otherIds } }).select("name email").lean()
        : [],
    ]);

    const profileById = new Map();
    for (const u of users) {
      profileById.set(normalizeId(u._id), {
        _id: u._id,
        name: u.name,
        email: u.email,
      });
    }
    for (const a of agencies) {
      profileById.set(normalizeId(a._id), {
        _id: a._id,
        name: a.name,
        email: a.email,
      });
    }

    const chatsWithOther = chats.map((chat) => {
      const oid = otherParticipantId(chat.participants, userId);
      const otherUser = oid ? profileById.get(oid) || null : null;
      const latest = latestByChat.get(normalizeId(chat._id));
      const {
        lastMessage,
        lastMessageByMe,
        lastMessageCreatedAt,
        lastMessageDeliveryStatus,
      } = previewFromDirectMessage(latest, userId);

      return {
        _id: chat._id,
        otherUser,
        lastMessageAt: chat.lastMessageAt,
        lastMessage,
        lastMessageByMe,
        lastMessageCreatedAt,
        lastMessageDeliveryStatus,
        createdAt: chat.createdAt,
      };
    });

    res.json({ chats: chatsWithOther });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/direct-chats - Get or create direct chat with user
router.post("/", authenticate, async (req, res) => {
  try {
    const { otherUserId } = req.body;
    const userId = req.headers["x-user-id"];

    if (!otherUserId) {
      return res.status(400).json({ message: "otherUserId is required" });
    }

    if (otherUserId === userId) {
      return res.status(400).json({ message: "Cannot chat with yourself" });
    }

    const chat = await getOrCreateDirectChat(userId, otherUserId);
    const fresh = await DirectChat.findById(chat._id).lean();
    const oid = otherParticipantId(fresh?.participants, userId);
    const other = oid ? await resolveParticipantProfile(oid) : null;

    const io = req.app.get("io");
    const roomName = `direct_${chat._id}`;
    autoJoinSocketRoom(io, userId, roomName);
    autoJoinSocketRoom(io, otherUserId, roomName);

    res.json({
      chat: {
        _id: fresh._id,
        participants: fresh.participants,
        otherUser: other,
        lastMessageAt: fresh.lastMessageAt,
        createdAt: fresh.createdAt,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/direct-chats/messages/:id - Edit message (must be before /:id)
router.put("/messages/:id", authenticate, async (req, res) => {
  return res.status(410).json({
    message:
      "Message edit endpoint is disabled; use socket events for ephemeral chat",
    socketOnly: true,
  });
});

// DELETE /api/direct-chats/messages/:id - Delete message
router.delete("/messages/:id", authenticate, async (req, res) => {
  return res.status(410).json({
    message:
      "Message delete endpoint is disabled; use socket events for ephemeral chat",
    socketOnly: true,
  });
});

// GET /api/direct-chats/:id - Get direct chat by id
router.get("/:id", authenticate, async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    const chat = await DirectChat.findById(req.params.id).lean();

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    const uid = normalizeId(userId);
    const isParticipant = chat.participants.some(
      (p) => normalizeId(p) === uid,
    );
    if (!isParticipant) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const oid = otherParticipantId(chat.participants, userId);
    const otherUser = oid ? await resolveParticipantProfile(oid) : null;
    res.json({
      chat: {
        ...chat,
        otherUser,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/direct-chats/:id/messages - Fetch persisted messages
router.get("/:id/messages", authenticate, async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];

    const chat = await DirectChat.findById(req.params.id);
    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    if (!chat.participants.some((p) => p.toString() === userId)) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before;

    const query = { directChat: req.params.id };
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await DirectMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("sender", "name email")
      .populate("replyTo", "content sender messageType")
      .lean();

    res.json({ messages, count: messages.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/direct-chats/:id/messages - Send message
router.post("/:id/messages", authenticate, async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];

    const chat = await DirectChat.findById(req.params.id);
    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    if (!chat.participants.some((p) => p.toString() === userId)) {
      return res.status(403).json({ message: "Not authorized" });
    }

    await DirectChat.findByIdAndUpdate(req.params.id, {
      lastMessageAt: new Date(),
    });

    res.status(202).json({
      message: "Accepted for socket relay only; message is not persisted",
      socketOnly: true,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
