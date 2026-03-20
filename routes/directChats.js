import express from "express";
import DirectChat from "../models/DirectChat.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

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
      "name email"
    );
  }

  return chat;
}

// GET /api/direct-chats - List my direct chats (socket-only delivery)
router.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];

    const chats = await DirectChat.find({ participants: userId })
      .populate("participants", "name email")
      .sort({ lastMessageAt: -1 })
      .lean();

    const chatsWithOther = chats.map((chat) => {
      const other = chat.participants.find(
        (p) => p._id.toString() !== userId
      );
      return {
        _id: chat._id,
        otherUser: other,
        lastMessageAt: chat.lastMessageAt,
        lastMessage: null,
        lastMessageByMe: false,
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
    const other = chat.participants.find((p) => p._id.toString() !== userId);

    res.json({
      chat: {
        _id: chat._id,
        participants: chat.participants,
        otherUser: other,
        lastMessageAt: chat.lastMessageAt,
        createdAt: chat.createdAt,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/direct-chats/messages/:id - Edit message (must be before /:id)
router.put("/messages/:id", authenticate, async (req, res) => {
  return res.status(410).json({
    message: "Message edit endpoint is disabled; use socket events for ephemeral chat",
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
    const chat = await DirectChat.findById(req.params.id)
      .populate("participants", "name email")
      .lean();

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    const isParticipant = chat.participants.some(
      (p) => p._id.toString() === userId
    );
    if (!isParticipant) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const other = chat.participants.find((p) => p._id.toString() !== userId);
    res.json({
      chat: {
        ...chat,
        otherUser: other,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/direct-chats/:id/messages - Socket-only message channel
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

    res.json({
      messages: [],
      count: 0,
      socketOnly: true,
      message:
        "Direct messages are delivered in real time only and are not stored",
    });
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
