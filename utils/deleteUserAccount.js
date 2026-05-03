import mongoose from "mongoose";
import Favorite from "../models/Favorite.js";
import Purchase from "../models/Purchase.js";
import LeadAssignment from "../models/LeadAssignment.js";
import Property from "../models/Property.js";
import DirectChat from "../models/DirectChat.js";
import DirectMessage from "../models/DirectMessage.js";
import UniversityGroup from "../models/UniversityGroup.js";
import ChatMessage from "../models/ChatMessage.js";

/**
 * Removes all MongoDB documents tied to a customer user before deleting the User record.
 * Does not delete the User document — caller handles that after password verification.
 */
export async function deleteCustomerUserData(userId) {
  const uid =
    userId instanceof mongoose.Types.ObjectId
      ? userId
      : new mongoose.Types.ObjectId(String(userId));
  const uidStr = uid.toString();

  await Favorite.deleteMany({ user: uid });
  await Purchase.deleteMany({ buyer: uid });
  await LeadAssignment.deleteMany({ assignedBy: uid });
  await Property.deleteMany({ ownerType: "User", owner: uid });

  const directChats = await DirectChat.find({ participants: uid })
    .select("_id")
    .lean();
  const dcIds = directChats.map((c) => c._id);
  if (dcIds.length > 0) {
    await DirectMessage.deleteMany({ directChat: { $in: dcIds } });
    await DirectChat.deleteMany({ _id: { $in: dcIds } });
  }

  await ChatMessage.deleteMany({ sender: uid });
  await ChatMessage.updateMany(
    { "reactions.user": uid },
    { $pull: { reactions: { user: uid } } },
  );
  await ChatMessage.updateMany({ mentions: uid }, { $pull: { mentions: uid } });

  const groups = await UniversityGroup.find({
    $or: [{ members: uid }, { admins: uid }, { createdBy: uid }],
  });

  for (const g of groups) {
    const members = (g.members || []).filter((m) => m.toString() !== uidStr);
    const admins = (g.admins || []).filter((a) => a.toString() !== uidStr);

    if (members.length === 0) {
      await ChatMessage.deleteMany({ group: g._id });
      await UniversityGroup.deleteOne({ _id: g._id });
      continue;
    }

    let createdBy = g.createdBy;
    if (createdBy && createdBy.toString() === uidStr) {
      createdBy = members[0];
    }

    let newAdmins = admins;
    if (newAdmins.length === 0) {
      newAdmins = [createdBy];
    }

    await UniversityGroup.updateOne(
      { _id: g._id },
      {
        $set: {
          members,
          admins: newAdmins,
          createdBy,
        },
      },
    );
  }
}
