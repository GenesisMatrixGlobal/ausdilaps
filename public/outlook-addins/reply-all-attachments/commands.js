/* Reply All + Files: opens a reply-all with the original file attachments re-attached.
 *
 * Two routes, because Outlook for Mac stops at Mailbox 1.14:
 *  - Mailbox 1.15+ (web, Windows): hand the files straight to the reply form.
 *  - Older (Mac): park the files in IndexedDB, open a plain reply-all, and let the
 *    OnNewMessageCompose handler below attach them to that reply.
 */

Office.onReady();

const NOTIFICATION_KEY = "replyAllAttachments";
const STASH_MAX_AGE_MS = 60 * 1000;

function showError(item, message) {
  // Outlook caps notification text at 150 characters.
  item.notificationMessages.replaceAsync(NOTIFICATION_KEY, {
    type: Office.MailboxEnums.ItemNotificationMessageType.ErrorMessage,
    message: message.slice(0, 150),
  });
}

function getContent(item, attachment) {
  return new Promise((resolve) => {
    item.getAttachmentContentAsync(attachment.id, (result) => {
      if (result.status !== Office.AsyncResultStatus.Succeeded) return resolve(null);
      const { content, format } = result.value;
      const formats = Office.MailboxEnums.AttachmentContentFormat;
      if (format === formats.Base64) {
        return resolve({ name: attachment.name, base64file: content });
      }
      if (format === formats.Eml) {
        // Attached emails come back as raw .eml text.
        const bytes = new TextEncoder().encode(content);
        let binary = "";
        bytes.forEach((b) => (binary += String.fromCharCode(b)));
        const name = /\.eml$/i.test(attachment.name) ? attachment.name : attachment.name + ".eml";
        return resolve({ name, base64file: btoa(binary) });
      }
      resolve(null); // cloud links and calendar items are skipped
    });
  });
}

// --- Stash (Mac route) -------------------------------------------------------------

function stashStore(mode) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("replyAllAttachments", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("stash");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result.transaction("stash", mode).objectStore("stash"));
  });
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putStash(value) {
  const store = await stashStore("readwrite");
  await request(store.put(value, "pending"));
}

/** Reads and clears the stash, so files can only ever land on one reply. */
async function takeStash() {
  const store = await stashStore("readwrite");
  const value = await request(store.get("pending"));
  if (value) await request(store.delete("pending"));
  return value;
}

// --- Read mode: the ribbon button --------------------------------------------------

function openReplyAll(item, formData) {
  return new Promise((resolve, reject) => {
    item.displayReplyAllFormAsync(formData, (result) =>
      result.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(result.error)
    );
  });
}

async function replyAllWithAttachments(event) {
  const item = Office.context.mailbox.item;
  try {
    // Inline images are left out: Outlook keeps them in the quoted message itself.
    const wanted = item.attachments.filter((a) => !a.isInline);
    const files = (await Promise.all(wanted.map((a) => getContent(item, a)))).filter(Boolean);

    if (Office.context.requirements.isSetSupported("Mailbox", "1.15")) {
      const attachments = files.map((f) => ({
        type: Office.MailboxEnums.AttachmentType.Base64,
        name: f.name,
        base64file: f.base64file,
      }));
      await openReplyAll(item, { htmlBody: "", attachments });
    } else {
      if (files.length) {
        await putStash({ files, conversationId: item.conversationId, at: Date.now() });
      }
      await openReplyAll(item, { htmlBody: "" });
    }

    const skipped = wanted.length - files.length;
    if (skipped > 0) {
      showError(item, `${skipped} attachment${skipped > 1 ? "s" : ""} could not be copied to the reply. Add ${skipped > 1 ? "them" : "it"} manually.`);
    }
  } catch (error) {
    showError(item, "Reply All + Files failed: " + ((error && error.message) || error));
  } finally {
    event.completed();
  }
}

// --- Compose mode: runs when any new message or reply opens --------------------------

function attach(item, file) {
  return new Promise((resolve) => {
    item.addFileAttachmentFromBase64Async(file.base64file, file.name, (result) =>
      resolve(result.status === Office.AsyncResultStatus.Succeeded)
    );
  });
}

async function attachStashed(event) {
  try {
    if (typeof indexedDB === "undefined") return; // classic Windows event runtime; it uses the 1.15 route
    const stash = await takeStash();
    if (!stash || Date.now() - stash.at > STASH_MAX_AGE_MS) return;

    const item = Office.context.mailbox.item;
    // Only the reply this button just opened gets the files, not an unrelated new email.
    if (stash.conversationId && item.conversationId && stash.conversationId !== item.conversationId) return;

    let failed = 0;
    for (const file of stash.files) {
      if (!(await attach(item, file))) failed++;
    }
    if (failed > 0) {
      showError(item, `${failed} attachment${failed > 1 ? "s" : ""} could not be added to this reply. Add ${failed > 1 ? "them" : "it"} manually.`);
    }
  } catch (error) {
    // Never block composing over this.
  } finally {
    event.completed();
  }
}

Office.actions.associate("replyAllWithAttachments", replyAllWithAttachments);
Office.actions.associate("attachStashed", attachStashed);
