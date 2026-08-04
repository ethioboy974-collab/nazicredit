"use strict";

function createOrderNotificationService(options = {}) {
  const providerName = String(options.provider || "log").trim().toLowerCase();
  const providers = {
    log: createLogProvider(options.logger || console),
    twilio: createTwilioProvider(options.twilio || {}),
    ...(options.providers || {}),
  };
  const provider = providers[providerName];
  if (!provider) throw new Error(`Unsupported order notification provider: ${providerName}`);

  return {
    providerName,
    async sendOrderReady(order) {
      const message = `Hello ${order.customerName}, your order from NaziCredit is ready for pickup. Thank you for shopping with us.`;
      const result = await provider.send({
        channel: "sms",
        recipient: order.customerPhone,
        message,
        orderId: order.id,
      });
      return {
        provider: providerName,
        channel: result.channel || "sms",
        messageId: result.messageId || null,
        message,
      };
    },
  };
}

function createTwilioProvider(config) {
  const accountSid = String(config.accountSid || "").trim();
  const authToken = String(config.authToken || "").trim();
  const fromNumber = String(config.fromNumber || "").trim();
  const messagingServiceSid = String(config.messagingServiceSid || "").trim();
  return {
    async send(notification) {
      if (!accountSid || !authToken || (!fromNumber && !messagingServiceSid)) {
        throw new Error("Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID.");
      }
      const form = new URLSearchParams({ To: notification.recipient, Body: notification.message });
      if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
      else form.set("From", fromNumber);
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || `Twilio rejected the message (${response.status})`);
      return { channel: "sms", messageId: result.sid || null };
    },
  };
}

function createLogProvider(logger) {
  return {
    async send(notification) {
      const messageId = `log-${notification.orderId}-${Date.now()}`;
      logger.info("Order notification (development provider)", { ...notification, messageId });
      return { channel: notification.channel, messageId };
    },
  };
}

module.exports = { createOrderNotificationService };
