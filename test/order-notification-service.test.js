"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createOrderNotificationService } = require("../order-notification-service");

test("passes a provider-neutral ready notification to the selected adapter", async () => {
  const deliveries = [];
  const service = createOrderNotificationService({
    provider: "test-provider",
    providers: {
      "test-provider": {
        async send(notification) {
          deliveries.push(notification);
          return { channel: "whatsapp", messageId: "message-123" };
        },
      },
    },
  });

  const result = await service.sendOrderReady({
    id: "order-1",
    customerName: "Marta",
    customerPhone: "+15550102020",
  });

  assert.equal(deliveries.length, 1);
  assert.deepEqual(deliveries[0], {
    channel: "sms",
    recipient: "+15550102020",
    message: "Hello Marta, your order from NaziCredit is ready for pickup. Thank you for shopping with us.",
    orderId: "order-1",
  });
  assert.equal(result.provider, "test-provider");
  assert.equal(result.channel, "whatsapp");
  assert.equal(result.messageId, "message-123");
});

test("normalizes US customer phone numbers before sending SMS", async () => {
  const deliveries = [];
  const service = createOrderNotificationService({
    provider: "test-provider",
    providers: {
      "test-provider": {
        async send(notification) {
          deliveries.push(notification);
          return { channel: "sms", messageId: "message-456" };
        },
      },
    },
  });

  await service.sendOrderReady({
    id: "order-2",
    customerName: "Gech",
    customerPhone: "5714816196",
  });

  assert.equal(deliveries[0].recipient, "+15714816196");
});
test("accepts the built-in Twilio provider during setup", () => {
  const service = createOrderNotificationService({
    provider: "twilio",
    twilio: {
      accountSid: "AC00000000000000000000000000000000",
      authToken: "test-token",
      fromNumber: "+15551234567",
    },
  });

  assert.equal(service.providerName, "twilio");
});

test("rejects an unknown provider during setup", () => {
  assert.throws(
    () => createOrderNotificationService({ provider: "missing" }),
    /Unsupported order notification provider: missing/,
  );
});
