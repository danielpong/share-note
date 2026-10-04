const express = require('express');
const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: 'bYEtfd7t+uvg1kUTaKJiUfVkb7ky3C61+QvPqmmc/BdZpKlNMgMbCsLgUshjXmkE0LFXDvJ93/79s4wy06K3h8Jp76FA5QiIQoB0isVpvMzqUS5WWjE37ewoGi4kAidnvnaXbUV9FUB870KZbTPRfAdB04t89/1O/w1cDnyilFU=',
  channelSecret: '655a578dbece5f0b0625c343d122bd76'
};

const app = express();

let chatData = {};
let subscriptions = {};
let userLastActiveTopic = {};
let userLastActiveGroup = {};

const TRIAL_DAYS = 7;
const BOT_ADD_FRIEND_URL = 'https://line.me/R/ti/p/@share_note';

function getChatStore(chatId) {
  if (!chatData[chatId]) {
    chatData[chatId] = { notes: {}, latestTopic: "", topicOrder: [] };
  }
  return chatData[chatId];
}

function checkAndManageSubscription(chatId) {
  const now = new Date();
  
  if (!subscriptions[chatId]) {
    const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    subscriptions[chatId] = {
      status: 'trial',
      expiresAt: trialEndsAt,
      plan: 'free_trial'
    };
  }

  const sub = subscriptions[chatId];
  const expiryDate = new Date(sub.expiresAt);

  if (expiryDate < now && sub.status !== 'active') {
    sub.status = 'expired';
  }

  return sub;
}

function getTrialHeader(sub) {
  if (sub.status === 'expired') {
    return `⏳ [TRIAL EXPIRED - PLEASE SUBSCRIBE]\n`;
  }
  
  const now = new Date();
  const expiryDate = new Date(sub.expiresAt);
  const diffTime = expiryDate - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const remainingDays = Math.max(0, diffDays);

  if (sub.status === 'trial') {
    return `⏳ [Free Trial: ${remainingDays} days remaining - Type "subscribe to upgrade]\n`;
  }
  
  return `✅ [Prepaid Plan Active]\n`;
}

function touchTopic(store, key) {
  store.topicOrder = store.topicOrder.filter(k => k !== key);
  store.topicOrder.unshift(key);
}

function getShortTimestamp() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${dd}-${mm}/${hh}:${min}`;
}

function formatNoteOutput(note) {
  if (!note || note.entries.length === 0) return "(No entries yet)";
  let output = note.entries.map((e, index) => {
    if (index === 0) {
      return e.text;
    } else {
      const name = e.displayName || "User";
      const time = e.timestamp || "";
      const editedTag = e.isEdited ? "(edited)" : "";
      return `💬 ${name} - ${e.text}${time ? ' / ' + time + editedTag : ''}`;
    }
  }).join('\n');

  if (note.creatorName) {
    output += `\n\n👤 Creator: ${note.creatorName}`;
  }
  if (note.createdAt) {
    output += `\n📌 Created: ${note.createdAt}`;
  }
  return output;
}

function createNoteFlexMessage(trialHeader, statusBadge, note, userId, recentTopics) {
  const contentBody = formatNoteOutput(note);
  
  let recentButtons = [];
  if (recentTopics && recentTopics.length > 0) {
    recentButtons = recentTopics.slice(0, 3).map(topic => ({
      type: 'button',
      style: 'primary',
      height: 'sm',
      action: {
        type: 'postback',
        label: `📌 ${topic.title}`,
        data: `action=view_topic_privately&topicKey=${encodeURIComponent(topic.key)}&userId=${userId}`
      },
      color: '#0084FF'
    }));
  }
  
  const flexContents = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: `${trialHeader}${statusBadge}[Topic: ${note.title}]`,
          weight: 'bold',
          size: 'sm',
          color: '#1DB446',
          wrap: true
        },
        {
          type: 'separator',
          margin: 'md'
        },
        {
          type: 'text',
          text: contentBody,
          size: 'sm',
          wrap: true,
          margin: 'md'
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: []
    }
  };
  
  if (recentButtons.length > 0) {
    recentButtons.forEach(button => {
      flexContents.footer.contents.push(button);
    });
  }
  
  flexContents.footer.contents.push({
    type: 'button',
    style: 'primary',
    height: 'sm',
    action: {
      type: 'postback',
      label: '📋 View All Pinned Topics',
      data: `action=send_pin_privately&userId=${userId}`
    },
    color: '#06C755'
  });
  
  return {
    type: 'flex',
    altText: `Topic: ${note.title}`,
    contents: flexContents
  };
}

function createGuideFlexMessage(title, summaryItems) {
  const contents = summaryItems.map(item => ({
    type: 'text',
    text: item,
    size: 'sm',
    wrap: true,
    margin: 'md'
  }));

  return {
    type: 'flex',
    altText: title,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: title,
            weight: 'bold',
            size: 'md',
            color: '#1DB446',
            wrap: true
          },
          {
            type: 'separator',
            margin: 'md'
          },
          ...contents
        ]
      }
    }
  };
}

function createNotePlainText(trialHeader, statusBadge, note) {
  const contentBody = formatNoteOutput(note);
  return `${trialHeader}${statusBadge}[Topic: ${note.title}]\n----------------------------------\n${contentBody}\n----------------------------------\n💡 To reply, just type your message directly here!\n✏️ To edit your reply, start with: edit: [your new message]`;
}

function createPinPlainText(trialHeader, store) {
  const topRecent = store.topicOrder.slice(0, 5);
  let pinText = `${trialHeader}📢 [PINNED TOPICS]\nHere are the most active topics:\n`;
  
  topRecent.forEach((k, idx) => {
    const note = store.notes[k];
    const replyCount = Math.max(0, note.entries.length - 1);
    pinText += `\n${idx + 1}. 📌 ${note.title} (${replyCount} replies)`;
  });
  
  pinText += `\n\n☝️ Type: view [topic name] to open it here.`;
  return pinText;
}

app.post('/webhook', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error("Webhook processing error:", err);
      res.status(500).end();
    });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/line-pay/confirm', async (req, res) => {
  const { chatId, plan } = req.query;
  if (!chatId) return res.status(400).send("Invalid callback parameters.");

  try {
    const daysToAdd = plan === 'yearly' ? 365 : 30;
    const now = new Date();
    
    if (!subscriptions[chatId] || subscriptions[chatId].status === 'expired') {
      subscriptions[chatId] = { status: 'active', plan: plan || 'monthly', expiresAt: new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000) };
    } else {
      const currentExpiry = new Date(subscriptions[chatId].expiresAt);
      const baseDate = currentExpiry > now ? currentExpiry : now;
      subscriptions[chatId].expiresAt = new Date(baseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
      subscriptions[chatId].status = 'active';
      subscriptions[chatId].plan = plan || 'monthly';
    }

    res.send(`<!DOCTYPE html><html><body style="font-family: Arial; text-align: center; margin-top: 50px;"><h2>✅ Payment Successful!</h2><p>Your subscription has been activated successfully. You can return to LINE.</p></body></html>`);
  } catch (error) {
    console.error("Payment confirmation error:", error);
    res.status(500).send("Payment confirmation failed.");
  }
});

const client = new line.messagingApi.MessagingApiClient(config);

async function handleEvent(event) {
  if (event.type === 'postback') {
    const userId = event.source.userId;
    const chatId = event.source.groupId || event.source.roomId || userId;
    const data = event.postback.data;
    const params = new URLSearchParams(data);
    const action = params.get('action');
    
    if (action === 'send_pin_privately') {
      const store = getChatStore(chatId);
      const sub = checkAndManageSubscription(chatId);
      const trialHeader = getTrialHeader(sub);
      
      if (store.topicOrder.length === 0) {
        try {
          await client.pushMessage({ to: userId, messages: [{ type: 'text', text: `📌 No topics available to pin yet.` }] });
        } catch (e) {
          console.error("Push failed:", e);
        }
      } else {
        const pinText = createPinPlainText(trialHeader, store);
        try {
          await client.pushMessage({ to: userId, messages: [{ type: 'text', text: pinText }] });
        } catch (e) {
          console.error("Push failed (likely not friends):", e);
        }
      }
      return Promise.resolve(null);
    }

    if (action === 'view_topic_privately') {
      const topicKey = decodeURIComponent(params.get('topicKey'));
      const store = getChatStore(chatId);
      const sub = checkAndManageSubscription(chatId);
      const trialHeader = getTrialHeader(sub);
      
      const targetNote = store.notes[topicKey];
      if (targetNote) {
        if (!targetNote.isLocked) touchTopic(store, topicKey);
        userLastActiveTopic[userId] = topicKey;
        userLastActiveGroup[userId] = chatId;
        
        const statusBadge = targetNote.isLocked ? `🏁 [COMPLETED & LOCKED]\n` : `📋 `;
        const notePlainText = createNotePlainText(trialHeader, statusBadge, targetNote);
        
        try {
          await client.pushMessage({ to: userId, messages: [{ type: 'text', text: notePlainText }] });
        } catch (e) {
          console.error("Push message failed (likely not friends):", e);
        }
      }
      return Promise.resolve(null);
    }
    
    return Promise.resolve(null);
  }
  
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const isGroup = event.source.groupId || event.source.roomId;
  const chatId = event.source.groupId || event.source.roomId || event.source.userId;
  const userId = event.source.userId;
  
  const rawText = event.message.text.trim();
  const lowerText = rawText.toLowerCase();

  // Trigger: "enguide (English Summary Flex Card)
  if (lowerText === '"enguide' || lowerText === 'enguide' || lowerText === '`"enguide`' || lowerText === '“enguide' || lowerText === '”enguide') {
    const enSummary = [
      '• "new topic / "new topic [name] "content [text]: Create a new topic with initial content and record the creator.',
      '• "reply [topic] [text]: Reply to a topic quietly; records entry and notifies via DM.',
      '• edit: [text] / "edit reply [topic] [text]: Update or edit your existing reply quietly.',
      '• "content [topic] [text]: Add content/introduction to an existing topic.',
      '• "edit content [topic] [text]: Edit the main text of a topic (creator only).',
      '• pin: Display the latest topic flex message card in the group chat.',
      '• "note [topic] done: Complete and lock a project note, archiving its report.',
      '• "status: Check current subscription/trial status and validity.',
      '• "subscribe: Display secure LINE Pay checkout options for plans.'
    ];
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [createGuideFlexMessage('🇬🇧 English Trigger Guide', enSummary)]
    });
  }

  // Trigger: "tguide (Thai Summary Flex Card)
  if (lowerText === '"tguide' || lowerText === 'tguide' || lowerText === '`"tguide`' || lowerText === '“tguide' || lowerText === '”tguide') {
    const thSummary = [
      '• "new topic / "new topic [name] "content [text]: สร้างหัวข้อใหม่พร้อมเนื้อหาเริ่มต้นและบันทึกชื่อผู้สร้าง',
      '• "reply [topic] [text]: ตอบกลับหัวข้อแบบเงียบๆ บันทึกและส่งยืนยันเข้าแชทส่วนตัว (DM)',
      '• edit: [text] / "edit reply [topic] [text]: อัปเดตหรือแก้ไขข้อความที่เคยตอบกลับไปแล้ว',
      '• "content [topic] [text]: เพิ่มเนื้อหาหรือบทนำให้กับหัวข้อที่มีอยู่',
      '• "edit content [topic] [text]: แก้ไขเนื้อหาหลักของหัวข้อ (จำกัดเฉพาะผู้สร้าง)',
      '• pin: แสดงการ์ด Flex ข้อความของหัวข้อล่าสุดในแชทกลุ่ม',
      '• "note [topic] done: ปิดงานและล็อกโน้ตโปรเจกต์ พร้อมสรุปรายงาน',
      '• "status: ตรวจสอบสถานะแพ็กเกจและวันหมดอายุของกลุ่ม',
      '• "subscribe: แสดงปุ่มชำระเงินผ่าน LINE Pay สำหรับแพ็กเกจ'
    ];
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [createGuideFlexMessage('🇹🇭 คู่มือคำสั่งทริกเกอร์', thSummary)]
    });
  }

  let displayName = "User";
  try {
    if (event.source.groupId) {
      const profile = await client.getGroupMemberProfile(event.source.groupId, userId);
      displayName = profile.displayName;
    } else if (event.source.roomId) {
      const profile = await client.getRoomMemberProfile(event.source.roomId, userId);
      displayName = profile.displayName;
    } else {
      const profile = await client.getProfile(userId);
      displayName = profile.displayName;
    }
  } catch (err) {
    console.error("Profile fetch error:", err);
  }

  // Handle Private 1-on-1 DM Chat Interactions
  if (!isGroup) {
    let targetChatId = userLastActiveGroup[userId];
    
    // Fallback search across active stores if userLastActiveGroup is not set but userLastActiveTopic matches
    if (!targetChatId || !chatData[targetChatId]) {
      for (const gId of Object.keys(chatData)) {
        if (userLastActiveTopic[userId] && chatData[gId].notes[userLastActiveTopic[userId]]) {
          targetChatId = gId;
          break;
        }
      }
    }

    if (!targetChatId || !chatData[targetChatId]) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `📌 Please type "pin" or "view [topic]" inside your target group chat first so I know which group to target!` }]
      });
    }

    const activeStore = chatData[targetChatId];
    const sub = checkAndManageSubscription(targetChatId);
    const trialHeader = getTrialHeader(sub);

    // Allow creating new topics directly from private DM if desired
    if (lowerText.startsWith('"new topic ')) {
      const subText = rawText.substring(11).trim();
      const contentIndex = subText.toLowerCase().indexOf('"content ');
      
      let topicName = "";
      let initialContent = "";

      if (contentIndex !== -1) {
        topicName = subText.substring(0, contentIndex).trim();
        initialContent = subText.substring(contentIndex + 9).trim();
      } else {
        const altContentIndex = subText.toLowerCase().indexOf('content ');
        if (altContentIndex !== -1) {
          topicName = subText.substring(0, altContentIndex).trim();
          initialContent = subText.substring(altContentIndex + 8).trim();
        } else {
          topicName = subText;
        }
      }

      if (!topicName) {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ Please provide a topic name after "new topic".` }]
        });
      }

      const key = topicName.toLowerCase();
      if (activeStore.notes[key]) {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `⚠️ Warning: The topic "${topicName}" already exists in your active group!` }]
        });
      }

      const entries = initialContent ? [{ text: initialContent, userId: userId, displayName: displayName }] : [];
      activeStore.notes[key] = { 
        title: topicName, 
        entries: entries, 
        creatorId: userId, 
        creatorName: displayName, 
        editCount: 0, 
        isLocked: false, 
        createdAt: getShortTimestamp() 
      };
      activeStore.latestTopic = key;
      touchTopic(activeStore, key);
      userLastActiveTopic[userId] = key;

      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✨ New topic "${topicName}" has been successfully created in your group chat!` }]
      });
    }

    const currentKey = userLastActiveTopic[userId];
    const note = currentKey ? activeStore.notes[currentKey] : null;

    if (!note || note.isLocked) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ No active note selected. Type "view [topic]" or "pin" in your group chat first.` }]
      });
    }

    // 1. Handle '"reply [text]' in DM
    if (lowerText.startsWith('"reply ') || lowerText.startsWith('reply ')) {
      const replyMessageContent = rawText.startsWith('"reply ') ? rawText.substring(7).trim() : rawText.substring(6).trim();
      if (!replyMessageContent) {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ Please provide content for your reply.` }]
        });
      }

      const timestamp = getShortTimestamp();
      const existingReplyIndex = note.entries.findIndex((e, idx) => idx > 0 && e.userId === userId);
      if (existingReplyIndex !== -1) {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `⚠️ You already replied to "${note.title}". To update, type:\n"edit reply [your new message]` }]
        });
      }

      const newEntry = { text: replyMessageContent, userId: userId, displayName: displayName, timestamp: timestamp, isEdited: false };
      note.entries.splice(1, 0, newEntry);
      touchTopic(activeStore, currentKey);

      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✅ Your reply for "${note.title}" has been recorded successfully!` }]
      });
    }

    // 2. Handle '"edit reply [text]' or 'edit: [text]' in DM
    const isEditReplyCmd = lowerText.startsWith('"edit reply ') || lowerText.startsWith('edit reply ');
    const isEditColon = lowerText.startsWith('edit:');
    
    if (isEditReplyCmd || isEditColon) {
      const messageContent = isEditReplyCmd 
        ? (rawText.startsWith('"edit reply ') ? rawText.substring(12).trim() : rawText.substring(11).trim())
        : rawText.substring(rawText.indexOf(':') + 1).trim();

      if (!messageContent) {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ Please provide content for your edit.` }]
        });
      }

      const timestamp = getShortTimestamp();
      const existingIndex = note.entries.findIndex((e, idx) => idx > 0 && e.userId === userId);
      if (existingIndex === -1) {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ You haven't replied to "${note.title}" yet.` }]
        });
      }

      const updatedEntry = { text: messageContent, userId: userId, displayName: displayName, timestamp: timestamp, isEdited: true };
      note.entries.splice(existingIndex, 1);
      note.entries.splice(1, 0, updatedEntry);

      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✅ Your reply for "${note.title}" has been updated successfully!` }]
      });
    }

    // 3. Handle '"edit content [text]' in DM
    if (lowerText.startsWith('"edit content ') || lowerText.startsWith('edit content ')) {
      const newContent = rawText.startsWith('"edit content ') ? rawText.substring(14).trim() : rawText.substring(13).trim();
      
      if (note.creatorId && note.creatorId !== userId) {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `🔒 Permission denied: Only the creator of "${note.title}" can edit its content.` }]
        });
      }

      if (!newContent) {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ Please specify the updated content text.` }]
        });
      }

      note.editCount = (note.editCount || 0) + 1;
      if (note.entries.length > 0) {
        note.entries[0].text = newContent;
        note.entries[0].displayName = displayName;
      } else {
        note.entries.push({ text: newContent, userId: userId, displayName: displayName });
      }

      touchTopic(activeStore, currentKey);
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✏️ Note content for "${note.title}" updated successfully!` }]
      });
    }

    // 4. Handle '"note [topic] done' or '"note done' in DM
    if (lowerText.startsWith('"note ') && lowerText.endsWith(' done')) {
      note.isLocked = true;
      activeStore.topicOrder = activeStore.topicOrder.filter(k => k !== currentKey);
      if (activeStore.latestTopic === currentKey) {
        activeStore.latestTopic = activeStore.topicOrder[0] || "";
      }

      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `🏁 [PROJECT COMPLETED & ARCHIVED]\n📌 Topic: ${note.title}\n\n🔒 This share note is now locked and finalized.` }]
      });
    }

    // Default fallback for plain text in DM (treat as normal reply)
    const messageContent = rawText;
    const timestamp = getShortTimestamp();
    const existingReplyIndex = note.entries.findIndex((e, idx) => idx > 0 && e.userId === userId);
    
    if (existingReplyIndex !== -1) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `⚠️ You already replied to "${note.title}". To update, type:\n"edit reply [your new message]` }]
      });
    }

    const newEntry = { text: messageContent, userId: userId, displayName: displayName, timestamp: timestamp, isEdited: false };
    note.entries.splice(1, 0, newEntry);
    touchTopic(activeStore, currentKey);

    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: `✅ Your reply for "${note.title}" has been recorded successfully!` }]
    });
  }

  const sub = checkAndManageSubscription(chatId);
  const trialHeader = getTrialHeader(sub);

  if (lowerText === '"status' || lowerText === 'status') {
    const expiryStr = new Date(sub.expiresAt).toLocaleDateString();
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: `${trialHeader}Status: ${sub.status.toUpperCase()}\nValid until: ${expiryStr}` }]
    });
  }

  if (lowerText === '"subscribe' || lowerText === 'subscribe') {
    const hostUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;
    const monthlyCheckoutUrl = `${hostUrl}/line-pay/confirm?chatId=${chatId}&plan=monthly`;
    const yearlyCheckoutUrl = `${hostUrl}/line-pay/confirm?chatId=${chatId}&plan=yearly`;

    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ 
        type: 'text', 
        text: `💳 Secure Checkout via LINE Pay:\n\nSelect your prepaid plan below to complete payment:`,
        quickReply: {
          items: [
            { type: 'action', action: { type: 'uri', label: `Monthly Plan`, uri: monthlyCheckoutUrl } },
            { type: 'action', action: { type: 'uri', label: `Yearly Plan`, uri: yearlyCheckoutUrl } }
          ]
        }
      }]
    });
  }

  if (sub.status === 'expired') {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: `⏳ Your group's free trial has ended. Type "subscribe to activate.` }]
    });
  }

  const store = getChatStore(chatId);
  const nonFriendNotice = `⚠️ @${displayName} Please add friend with Share Note to receive private messages (note view, summary, reply, and edit confirmation):\n${BOT_ADD_FRIEND_URL}`;

  // Record active group context whenever group triggers happen
  userLastActiveGroup[userId] = chatId;

  // HANDLE '"reply [topic] [text]' COMMAND DIRECTLY IN GROUP
  if (lowerText.startsWith('"reply ') || lowerText.startsWith('reply ')) {
    const queryPart = rawText.startsWith('"reply ') ? rawText.substring(7).trim() : rawText.substring(6).trim();
    const allKeys = store.topicOrder.concat(Object.keys(store.notes).filter(k => !store.topicOrder.includes(k)));
    
    const matchedKey = allKeys
      .sort((a, b) => b.length - a.length)
      .find(k => queryPart.toLowerCase() === k || queryPart.toLowerCase().startsWith(k + ' '));

    if (!matchedKey) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ Topic not found for your reply.` }]
      });
    }

    const currentNote = store.notes[matchedKey];
    if (currentNote.isLocked) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `🔒 This note is completed and locked.` }]
      });
    }

    const replyMessageContent = queryPart.substring(matchedKey.length).trim();
    if (!replyMessageContent) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ Please provide content for your reply.` }]
      });
    }

    userLastActiveTopic[userId] = matchedKey;
    const timestamp = getShortTimestamp();

    const existingReplyIndex = currentNote.entries.findIndex((e, idx) => idx > 0 && e.userId === userId);
    if (existingReplyIndex !== -1) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `⚠️ You already replied to "${currentNote.title}". To update, type:\nedit: [your new message]` }]
      });
    }

    const newEntry = { text: replyMessageContent, userId: userId, displayName: displayName, timestamp: timestamp, isEdited: false };
    currentNote.entries.splice(1, 0, newEntry);
    touchTopic(store, matchedKey);

    try {
      await client.pushMessage({
        to: userId,
        messages: [{ type: 'text', text: `✅ Your reply for "${currentNote.title}" has been recorded successfully!` }]
      });
      return Promise.resolve(null);
    } catch (e) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: nonFriendNotice }]
      });
    }
  }

  // HANDLE '"edit reply [topic] [text]' COMMAND DIRECTLY IN GROUP
  if (lowerText.startsWith('"edit reply ') || lowerText.startsWith('edit reply ')) {
    const queryPart = rawText.startsWith('"edit reply ') ? rawText.substring(12).trim() : rawText.substring(11).trim();
    const allKeys = store.topicOrder.concat(Object.keys(store.notes).filter(k => !store.topicOrder.includes(k)));
    
    const matchedKey = allKeys
      .sort((a, b) => b.length - a.length)
      .find(k => queryPart.toLowerCase() === k || queryPart.toLowerCase().startsWith(k + ' '));

    if (!matchedKey) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ Topic not found for your edit.` }]
      });
    }

    const currentNote = store.notes[matchedKey];
    if (currentNote.isLocked) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `🔒 This note is completed and locked.` }]
      });
    }

    const newContent = queryPart.substring(matchedKey.length).trim();
    if (!newContent) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ Please provide content for your edit.` }]
      });
    }

    userLastActiveTopic[userId] = matchedKey;
    const timestamp = getShortTimestamp();

    const existingIndex = currentNote.entries.findIndex((e, idx) => idx > 0 && e.userId === userId);
    if (existingIndex === -1) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ You haven't replied to "${currentNote.title}" yet.` }]
      });
    }

    const updatedEntry = { text: newContent, userId: userId, displayName: displayName, timestamp: timestamp, isEdited: true };
    currentNote.entries.splice(existingIndex, 1);
    currentNote.entries.splice(1, 0, updatedEntry);

    try {
      await client.pushMessage({
        to: userId,
        messages: [{ type: 'text', text: `✅ Your reply for "${currentNote.title}" has been updated successfully!` }]
      });
      return Promise.resolve(null);
    } catch (e) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: nonFriendNotice }]
      });
    }
  }

  // HANDLE 'edit: [text]' COMMAND FOR NON-FRIENDS IN GROUP
  if (lowerText.startsWith('edit:')) {
    let targetChatId = null;
    let activeStore = null;

    for (const gId of Object.keys(chatData)) {
      if (userLastActiveTopic[userId] && chatData[gId].notes[userLastActiveTopic[userId]]) {
        targetChatId = gId;
        activeStore = chatData[gId];
        break;
      }
    }

    if (!targetChatId || !activeStore) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `📌 Please type "pin" or "view [topic]" inside your group chat first to select an active note topic.` }]
      });
    }

    const currentKey = userLastActiveTopic[userId];
    const note = activeStore.notes[currentKey];

    if (!note || note.isLocked) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ Note not found or is already locked.` }]
      });
    }

    const messageContent = rawText.substring(rawText.indexOf(':') + 1).trim();
    if (!messageContent) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ Please provide content for your edit.` }]
      });
    }

    const timestamp = getShortTimestamp();
    const existingIndex = note.entries.findIndex((e, idx) => idx > 0 && e.userId === userId);
    
    if (existingIndex === -1) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ You haven't replied to "${note.title}" yet.` }]
      });
    }

    const updatedEntry = { text: messageContent, userId: userId, displayName: displayName, timestamp: timestamp, isEdited: true };
    note.entries.splice(existingIndex, 1);
    note.entries.splice(1, 0, updatedEntry);

    try {
      await client.pushMessage({
        to: userId,
        messages: [{ type: 'text', text: `✅ Your reply for "${currentNote.title}" has been updated successfully!` }]
      });
      return Promise.resolve(null);
    } catch (e) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: nonFriendNotice }]
      });
    }
  }

  if (lowerText.startsWith('"note ') && lowerText.endsWith(' done')) {
    const topicQuery = rawText.substring(6, rawText.length - 5).trim().toLowerCase();
    const matchedKey = store.topicOrder.find(k => k === topicQuery || store.notes[k].title.toLowerCase() === topicQuery);

    if (!matchedKey || !store.notes[matchedKey]) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ Project topic not found to complete.` }]
      });
    }

    const note = store.notes[matchedKey];
    note.isLocked = true;
    store.topicOrder = store.topicOrder.filter(k => k !== matchedKey);
    if (store.latestTopic === matchedKey) {
      store.latestTopic = store.topicOrder[0] || "";
    }

    const finalReport = `${trialHeader}\n🏁 [PROJECT COMPLETED & ARCHIVED]\n📌 Topic: ${note.title}\n\n` + formatNoteOutput(note) + `\n\n🔒 This share note is now locked and finalized.`;
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: finalReport }]
    });
  }

  if (lowerText === '"new topic') {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: `${trialHeader}\n✨ To create a new topic and add content in one shot, type:\n"new topic [topic name] "content [your content]`
      }]
    });
  }

  if (lowerText.startsWith('"new topic ')) {
    const subText = rawText.substring(11).trim();
    const contentIndex = subText.toLowerCase().indexOf('"content ');
    
    let topicName = "";
    let initialContent = "";

    if (contentIndex !== -1) {
      topicName = subText.substring(0, contentIndex).trim();
      initialContent = subText.substring(contentIndex + 9).trim();
    } else {
      const altContentIndex = subText.toLowerCase().indexOf('content ');
      if (altContentIndex !== -1) {
        topicName = subText.substring(0, altContentIndex).trim();
        initialContent = subText.substring(altContentIndex + 8).trim();
      } else {
        topicName = subText;
      }
    }

    if (!topicName) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ Please provide a topic name after "new topic".` }]
      });
    }

    const key = topicName.toLowerCase();
    if (store.notes[key]) {
      const duplicateMsg = `⚠️ Warning: The topic "${topicName}" already exists in this group!`;
      try {
        await client.pushMessage({ to: userId, messages: [{ type: 'text', text: duplicateMsg }] });
        return Promise.resolve(null);
      } catch (e) {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: nonFriendNotice }]
        });
      }
    }

    const entries = initialContent ? [{ text: initialContent, userId: userId, displayName: displayName }] : [];
    store.notes[key] = { 
      title: topicName, 
      entries: entries, 
      creatorId: userId, 
      creatorName: displayName, 
      editCount: 0, 
      isLocked: false, 
      createdAt: getShortTimestamp() 
    };
    store.latestTopic = key;
    touchTopic(store, key);
    userLastActiveTopic[userId] = key;

    try {
      await client.pushMessage({ to: userId, messages: [{ type: 'text', text: createNotePlainText(trialHeader, '✨ ', store.notes[key]) }] });
    } catch (e) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: nonFriendNotice }]
      });
    }

    const recentTopics = store.topicOrder.filter(k => k !== key).slice(0, 3).map(k => ({ title: store.notes[k].title, key: k }));
    const flexMsg = createNoteFlexMessage(trialHeader, '✨ ', store.notes[key], userId, recentTopics);

    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [flexMsg]
    });
  }

  if (lowerText.startsWith('"content ')) {
    const contentAfterContent = rawText.substring(9).trim().toLowerCase();
    const matchedKey = store.topicOrder.sort((a, b) => b.length - a.length).find(k => contentAfterContent === k || contentAfterContent.startsWith(k + ' '));

    if (!matchedKey) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ Topic not found in this group. Type "pin" to see all available topics.` }]
      });
    }

    const note = store.notes[matchedKey];
    if (note.isLocked) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `🔒 This project note is already completed and locked.` }]
      });
    }

    const introContent = rawText.substring(9).trim().substring(matchedKey.length).trim();
    if (!introContent) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ Please include content/introduction text after the topic name.` }]
      });
    }

    note.entries.unshift({ text: introContent, userId: userId, displayName: displayName });
    store.latestTopic = matchedKey;
    touchTopic(store, matchedKey);
    userLastActiveTopic[userId] = matchedKey;

    try {
      await client.pushMessage({ to: userId, messages: [{ type: 'text', text: createNotePlainText(trialHeader, '✅ ', note) }] });
      return Promise.resolve(null);
    } catch (e) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: nonFriendNotice }]
      });
    }
  }

  // HANDLE '"edit content xxxx xxxx'
  if (lowerText.startsWith('"edit content ')) {
    const contentAfterEdit = rawText.substring(14).trim().toLowerCase();
    const matchedKey = store.topicOrder.sort((a, b) => b.length - a.length).find(k => contentAfterEdit === k || contentAfterEdit.startsWith(k + ' '));

    if (!matchedKey) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ Topic not found in this group.` }]
      });
    }

    const noteItem = store.notes[matchedKey];
    if (noteItem.isLocked) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `🔒 This project note is completed and locked.` }]
      });
    }

    if (noteItem.creatorId && noteItem.creatorId !== userId) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `🔒 Permission denied: Only the creator of "${noteItem.title}" can edit its content.` }]
      });
    }

    const rawNewContent = rawText.substring(14).trim().substring(matchedKey.length).trim();
    if (!rawNewContent) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ Please specify the updated content text.` }]
      });
    }

    noteItem.editCount = (noteItem.editCount || 0) + 1;
    if (noteItem.entries.length > 0) {
      noteItem.entries[0].text = rawNewContent;
      noteItem.entries[0].displayName = displayName;
    } else {
      noteItem.entries.push({ text: rawNewContent, userId: userId, displayName: displayName });
    }

    touchTopic(store, matchedKey);
    userLastActiveTopic[userId] = matchedKey;

    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: `✏️ Note content updated successfully!` }]
    });
  }

  const isPinStart = lowerText === 'pin' || lowerText.startsWith('pin ');
  const isPinQuotes = lowerText.includes('"pin');

  if (isPinStart || isPinQuotes) {
    if (store.topicOrder.length === 0) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `📌 No topics available to pin yet. Create one using: "new topic [topic name]` }]
      });
    }

    const latestKey = store.topicOrder[0];
    const latestNote = store.notes[latestKey];
    const statusBadge = latestNote.isLocked ? `🏁 [COMPLETED & LOCKED]\n` : `📋 `;
    const recentTopics = store.topicOrder.filter(k => k !== latestKey).slice(0, 3).map(k => ({ title: store.notes[k].title, key: k }));

    const flexMsg = createNoteFlexMessage(trialHeader, statusBadge, latestNote, userId, recentTopics);
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [flexMsg]
    });
  }

  const isViewStart = lowerText.startsWith('view ') || lowerText === 'view' || lowerText === 'note';
  const isViewQuotes = lowerText.includes('"view') || lowerText.includes('"note');

  if (isViewStart || isViewQuotes) {
    let queryPart = "";
    if (lowerText.startsWith('view ')) {
      queryPart = rawText.substring(5).trim();
    } else if (lowerText.includes('"view')) {
      const viewIndex = lowerText.indexOf('"view');
      queryPart = rawText.substring(viewIndex + 5).trim();
    }

    const allKeys = store.topicOrder.concat(Object.keys(store.notes).filter(k => !store.topicOrder.includes(k)));
    
    const matchedKey = allKeys
      .sort((a, b) => b.length - a.length)
      .find(k => queryPart.toLowerCase() === k || queryPart.toLowerCase().startsWith(k + ' '));

    if (!matchedKey) {
      if (!queryPart) {
        if (store.topicOrder.length === 0) {
          return client.replyMessage({
            replyToken: event.replyToken,
            messages: [{ type: 'text', text: `📋 No active notes available in this group.` }]
          });
        }
        
        // Plain text list of topics sent privately to DM
        try {
          const pinText = createPinPlainText(trialHeader, store);
          await client.pushMessage({ to: userId, messages: [{ type: 'text', text: pinText }] });
          return client.replyMessage({
            replyToken: event.replyToken,
            messages: [{ type: 'text', text: `✅ Pinned topics list has been sent to your private chat!` }]
          });
        } catch (e) {
          return client.replyMessage({
            replyToken: event.replyToken,
            messages: [{ type: 'text', text: nonFriendNotice }]
          });
        }
      }

      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ No note found matching query. Use "view [topic]"` }]
      });
    }

    const currentNote = store.notes[matchedKey];
    if (currentNote.isLocked) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `🔒 This project note is completed and locked.` }]
      });
    }

    touchTopic(store, matchedKey);
    userLastActiveTopic[userId] = matchedKey;

    const statusBadge = currentNote.isLocked ? `🏁 [COMPLETED & LOCKED]\n` : `📋 `;

    try {
      const notePlainText = createNotePlainText(trialHeader, statusBadge, currentNote);
      await client.pushMessage({ to: userId, messages: [{ type: 'text', text: notePlainText }] });
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✅ Note "${currentNote.title}" has5 been sent to your private chat!` }]
      });
    } catch (e) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: nonFriendNotice }]
      });
    }
  }

  return Promise.resolve(null);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running live on port ${PORT}`);
});