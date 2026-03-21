import express from "express";
import UniversityGroup from "../models/UniversityGroup.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

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

// GET /api/groups - List all university groups
router.get("/", async (req, res) => {
  try {
    const { country, university, limit = 50 } = req.query;
    const query = { isActive: true };

    if (country) {
      query.country = country;
    }
    if (university) {
      query.university = { $regex: university, $options: "i" };
    }

    const groups = await UniversityGroup.find(query)
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    // Add member count and user's membership status
    const userId = req.headers["x-user-id"];
    const groupsWithDetails = groups.map((group) => {
      const groupObj = group.toObject();
      groupObj.memberCount = group.members.length;
      groupObj.isMember = userId
        ? group.members.some((m) => m.toString() === userId)
        : false;
      return groupObj;
    });

    res.json({
      groups: groupsWithDetails,
      count: groupsWithDetails.length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/groups - Create group (authenticated users)
router.post("/", authenticate, async (req, res) => {
  try {
    const { name, university, country, description, avatarUrl } = req.body;

    if (!name || !university || !country) {
      return res.status(400).json({
        message: "Name, university, and country are required",
      });
    }

    if (req.userType === "AGENCY") {
      return res.status(403).json({
        message: "Only users can create groups",
      });
    }

    const userId = req.headers["x-user-id"];

    const group = await UniversityGroup.create({
      name,
      university,
      country,
      description,
      avatarUrl,
      createdBy: userId,
      admins: [userId],
      members: [userId],
    });

    const populatedGroup = await UniversityGroup.findById(group._id)
      .populate("createdBy", "name email")
      .populate("admins", "name email");

    const io = req.app.get("io");
    autoJoinSocketRoom(io, userId, `group_${group._id}`);

    res.status(201).json({
      message: "Group created successfully",
      group: populatedGroup,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/groups/:id - Get group details
router.get("/:id", async (req, res) => {
  try {
    const group = await UniversityGroup.findById(req.params.id)
      .populate("createdBy", "name email")
      .populate("admins", "name email")
      .populate("members", "name email");

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    const groupObj = group.toObject();
    groupObj.memberCount = group.members.length;

    res.json({ group: groupObj });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/groups/:id/join - Join a group
router.post("/:id/join", authenticate, async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    const group = await UniversityGroup.findById(req.params.id);

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    if (!group.isActive) {
      return res.status(403).json({ message: "Group is not active" });
    }

    if (group.members.some((m) => m.toString() === userId)) {
      return res.status(400).json({ message: "Already a member" });
    }

    group.members.push(userId);
    await group.save();

    const io = req.app.get("io");
    autoJoinSocketRoom(io, userId, `group_${group._id}`);

    res.json({
      message: "Joined group successfully",
      group: await group.populate("members", "name email"),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/groups/:id/leave - Leave a group
router.post("/:id/leave", authenticate, async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    const group = await UniversityGroup.findById(req.params.id);

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    if (!group.members.some((m) => m.toString() === userId)) {
      return res.status(400).json({ message: "Not a member" });
    }

    group.members = group.members.filter((m) => m.toString() !== userId);

    // If user is admin, remove from admins too
    if (group.admins.includes(userId)) {
      group.admins = group.admins.filter((a) => a.toString() !== userId);
    }

    await group.save();

    res.json({
      message: "Left group successfully",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/groups/:id/messages - Get chat history
router.get("/:id/messages", authenticate, async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];

    // Check if user is a member
    const group = await UniversityGroup.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    if (!group.members.some((m) => m.toString() === userId)) {
      return res.status(403).json({ message: "Not a member of this group" });
    }

    res.json({
      messages: [],
      count: 0,
      socketOnly: true,
      message: "Group messages are delivered in real time only and are not stored",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/groups/:id/messages - Send message
router.post("/:id/messages", authenticate, async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];

    // Check if user is a member
    const group = await UniversityGroup.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    if (!group.members.some((m) => m.toString() === userId)) {
      return res.status(403).json({ message: "Not a member of this group" });
    }

    res.status(202).json({
      message: "Accepted for socket relay only; message is not persisted",
      socketOnly: true,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/messages/:id - Edit message
router.put("/messages/:id", authenticate, async (req, res) => {
  return res.status(410).json({
    message: "Message edit endpoint is disabled; use socket events for ephemeral chat",
    socketOnly: true,
  });
});

// DELETE /api/messages/:id - Delete message
router.delete("/messages/:id", authenticate, async (req, res) => {
  return res.status(410).json({
    message:
      "Message delete endpoint is disabled; use socket events for ephemeral chat",
    socketOnly: true,
  });
});

// POST /api/messages/:id/react - Add reaction
router.post("/messages/:id/react", authenticate, async (req, res) => {
  return res.status(410).json({
    message:
      "Message reaction endpoint is disabled; use socket events for ephemeral chat",
    socketOnly: true,
  });
});

// DELETE /api/groups/:id - Delete group (group creator/admin or platform admin)
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const group = await UniversityGroup.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    const userId = req.headers["x-user-id"];
    const isPlatformAdmin = req.userType === "ADMIN";
    const isGroupAdmin = group.admins.some((a) => a.toString() === userId);
    const isCreator = group.createdBy?.toString() === userId;
    if (!isPlatformAdmin && !isGroupAdmin && !isCreator) {
      return res.status(403).json({
        message: "Not authorized to deactivate this group",
      });
    }

    group.isActive = false;
    await group.save();

    res.json({ message: "Group deactivated successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
