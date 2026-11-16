"use strict";

const { callGroupMemberAction } = require("./Bankai");

const CHECK_INTERVAL_MS = 3000;
const FACEBOOK_USER_NAME = "Facebook User";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeID(value) {
  if (value && typeof value === "object") {
    return String(value.id || value.userID || value.userFbId || "");
  }
  return String(value || "");
}

function isUnnamed(name) {
  const trimmed = String(name || "").trim();
  return trimmed === "" || trimmed === FACEBOOK_USER_NAME;
}

// نرفض العمل إذا لم تصل أسماء الأعضاء أصلاً، حتى لا نزيل أعضاء فعليين بسبب بيانات ناقصة.
function readMemberData(info, botID) {
  if (!info || !Array.isArray(info.participantIDs) || !info.userInfo) {
    throw new Error("تعذر قراءة أسماء أعضاء المجموعة.");
  }

  const entries = Array.isArray(info.userInfo)
    ? info.userInfo.map((user) => [normalizeID(user), user])
    : Object.entries(info.userInfo);
  const namesByID = new Map(
    entries.map(([id, user]) => [String(id), user && user.name]),
  );
  const adminIDs = new Set((info.adminIDs || []).map(normalizeID));

  const memberIDs = info.participantIDs
    .map((id) => String(id))
    .filter((id) => id && id !== String(botID) && !adminIDs.has(id));

  return { memberIDs, namesByID };
}

// يعتبر العضو معطلاً إذا لم يُرجع فيسبوك اسمه أو أرجع الاسم الافتراضي للحسابات المعطلة.
function findDisabledMemberIDs(info, botID) {
  const { memberIDs, namesByID } = readMemberData(info, botID);
  return memberIDs.filter((id) => isUnnamed(namesByID.get(id)));
}

module.exports = {
  name: "تنظيف",

  findDisabledMemberIDs,

  async execute(api, event) {
    const threadID = String(event.threadID || "");
    if (!threadID) return;

    if (event.isGroup === false) {
      await api.sendMessage("⚠️ هذا الأمر يعمل داخل المجموعات فقط.", threadID);
      return;
    }

    try {
      const botID = api.getCurrentUserID ? api.getCurrentUserID() : "";
      await api.sendMessage("🔍 جاري فحص أعضاء المجموعة حسابًا حسابًا...", threadID);
      const { memberIDs } = readMemberData(
        await api.getThreadInfo(threadID),
        botID,
      );

      if (memberIDs.length === 0) {
        await api.sendMessage("✅ لا يوجد أعضاء يمكن فحصهم في المجموعة.", threadID);
        return;
      }

      let removedCount = 0;
      let failedCount = 0;
      for (let index = 0; index < memberIDs.length; index++) {
        const uid = memberIDs[index];
        try {
          const current = readMemberData(
            await api.getThreadInfo(threadID),
            botID,
          );
          if (
            current.memberIDs.includes(uid) &&
            isUnnamed(current.namesByID.get(uid))
          ) {
            await callGroupMemberAction(api, "remove", uid, threadID);
            removedCount++;
          }
        } catch (error) {
          failedCount++;
          console.error(`[تنظيف] تعذر فحص أو إزالة ${uid}:`, error.message || error);
        }
        if (index < memberIDs.length - 1) await sleep(CHECK_INTERVAL_MS);
      }

      console.log(
        `[تنظيف] ✅ أُزيل ${removedCount} حسابًا معطلًا من ${threadID}، فشل ${failedCount}`,
      );
      await api.sendMessage(
        failedCount === 0
          ? `✅ انتهى الفحص. تمت إزالة ${removedCount} حسابًا معطلًا من المجموعة.`
          : `⚠️ انتهى الفحص. تمت إزالة ${removedCount} حسابًا معطلًا، وتعذر فحص أو إزالة ${failedCount}.`,
        threadID,
      );
    } catch (error) {
      console.error("[تنظيف] خطأ:", error.message || error);
      await api.sendMessage(
        `❌ تعذر تنظيف المجموعة: ${error.message || error}`,
        threadID,
      );
    }
  },
};
