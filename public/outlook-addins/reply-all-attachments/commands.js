/* Reply All with Attachments: opens a reply-all with the original file attachments re-attached. */

Office.onReady();

function showError(item, message) {
  // Outlook caps notification text at 150 characters.
  item.notificationMessages.replaceAsync("replyAllAttachments", {
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

async function replyAllWithAttachments(event) {
  const item = Office.context.mailbox.item;
  try {
    if (!Office.context.requirements.isSetSupported("Mailbox", "1.15")) {
      showError(item, "This version of Outlook is too old for Reply All with Attachments. Update Outlook and try again.");
      return;
    }

    // Inline images are left out: Outlook keeps them in the quoted message itself.
    const wanted = item.attachments.filter((a) => !a.isInline);
    const fetched = await Promise.all(wanted.map((a) => getContent(item, a)));
    const attachments = fetched
      .filter(Boolean)
      .map((a) => ({ type: Office.MailboxEnums.AttachmentType.Base64, name: a.name, base64file: a.base64file }));

    await new Promise((resolve, reject) => {
      item.displayReplyAllFormAsync({ htmlBody: "", attachments }, (result) =>
        result.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(result.error)
      );
    });

    const skipped = wanted.length - attachments.length;
    if (skipped > 0) {
      showError(item, `${skipped} attachment${skipped > 1 ? "s" : ""} could not be copied to the reply. Add ${skipped > 1 ? "them" : "it"} manually.`);
    }
  } catch (error) {
    showError(item, "Reply All with Attachments failed: " + ((error && error.message) || error));
  } finally {
    event.completed();
  }
}

Office.actions.associate("replyAllWithAttachments", replyAllWithAttachments);
