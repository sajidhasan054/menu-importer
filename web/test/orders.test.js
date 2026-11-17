import test from "node:test";
import assert from "node:assert/strict";
import { newProduct, newShop, syncVariants } from "../catalog.js";
import {
  ALL_DISTRICTS, allowedStatuses, courierRows, customerChatLink, customerMessage, deliveryCharge, itemFor, newOrder,
  normalizePhone, orderIssues, orderTotals, setStatus, summary,
} from "../orders.js";

function shopWithStock() {
  const shop = newShop({ name: "Dhaka Fashion House", currency: "BDT" });
  shop.orders = [];
  const shirt = newProduct(shop, { title: "Linen Shirt", price: "1850", salePrice: "1650", colors: ["Navy"], sizes: ["M", "L"] });
  syncVariants(shirt);
  shirt.variants[0].quantity = "5";
  shirt.variants[1].quantity = "";        // stock not tracked
  const belt = newProduct(shop, { title: "Leather Belt", price: "900", quantity: "2" });
  shop.products.push(shirt, belt);
  return { shop, shirt, belt };
}

test("all 64 districts, delivery charge inside and outside Dhaka", () => {
  assert.equal(ALL_DISTRICTS.length, 64);
  const shop = newShop({ name: "X", currency: "BDT" });
  assert.equal(deliveryCharge(shop, "Dhaka"), 70);
  assert.equal(deliveryCharge(shop, "Sylhet"), 130);
  shop.delivery = { insideDhaka: 60, outsideDhaka: 120 };
  assert.equal(deliveryCharge(shop, "Cox's Bazar"), 120);
});

test("Bangladesh phone numbers", () => {
  assert.equal(normalizePhone("01711-000000"), "8801711000000");
  assert.equal(normalizePhone("+880 1911 234567"), "8801911234567");
  assert.equal(normalizePhone("০১৮১২৩৪৫৬৭৮"), "8801812345678");
  assert.equal(normalizePhone("01211000000"), ""); // not a mobile prefix
  assert.equal(normalizePhone("12345"), "");
});

test("order numbers, totals with delivery, discount and advance", () => {
  const { shop, shirt, belt } = shopWithStock();
  const order = newOrder(shop, { customer: { name: "Rahim", phone: "01711000000", address: "House 5, Road 2", district: "Chattogram", area: "Agrabad" } });
  assert.equal(order.number, "DFH-ORD-1001");
  assert.equal(order.deliveryCharge, 130);
  order.items.push(itemFor(shirt, shirt.variants[0], 2), itemFor(belt, null, 1));
  assert.equal(order.items[0].price, "1650"); // sale price
  order.discount = 100;
  order.payment.advance = 130; // delivery charge paid by bKash in advance
  assert.deepEqual(orderTotals(order), { subtotal: 4200, total: 4230, advance: 130, collect: 4100 });
  order.payment = { method: "bkash", advance: 0 };
  assert.equal(orderTotals(order).collect, 0); // prepaid
  shop.orders.push(order);
  assert.equal(newOrder(shop).number, "DFH-ORD-1002");
  assert.deepEqual(orderIssues(order), []);
  assert.equal(orderIssues(newOrder(shop)).length, 5);
});

test("status flow takes stock on confirm and gives it back on cancel", () => {
  const { shop, shirt, belt } = shopWithStock();
  const order = newOrder(shop);
  order.items.push(itemFor(shirt, shirt.variants[0], 2), itemFor(shirt, shirt.variants[1], 1), itemFor(belt, null, 3));
  assert.deepEqual(allowedStatuses("new"), ["confirmed", "cancelled"]);
  assert.deepEqual(allowedStatuses("shipped"), ["delivered", "cancelled", "returned"]);
  assert.deepEqual(allowedStatuses("delivered"), []);
  setStatus(order, "confirmed", shop.products);
  assert.deepEqual([shirt.variants[0].quantity, shirt.variants[1].quantity, belt.quantity], ["3", "", "0"]);
  setStatus(order, "packed", shop.products); // no double counting
  assert.equal(shirt.variants[0].quantity, "3");
  setStatus(order, "cancelled", shop.products);
  assert.deepEqual([shirt.variants[0].quantity, belt.quantity], ["5", "3"]);
  assert.deepEqual(order.history.map(h => h.status), ["new", "confirmed", "packed", "cancelled"]);
});

test("customer messages in English and Bangla, with WhatsApp links", () => {
  const { shop, shirt } = shopWithStock();
  const order = newOrder(shop, { customer: { name: "Rahim", phone: "01711000000", address: "Agrabad", district: "Chattogram", area: "" } });
  order.items.push(itemFor(shirt, shirt.variants[0], 1));
  setStatus(order, "confirmed", shop.products);
  const en = customerMessage(order, shop, "en");
  assert.match(en, /Hi Rahim, your order DFH-ORD-1001 is confirmed/);
  assert.match(en, /• Linen Shirt \(Navy \/ M\) × 1 — ৳1,650/);
  assert.match(en, /To pay on delivery: ৳1,780/);
  setStatus(order, "packed", shop.products);
  setStatus(order, "shipped", shop.products);
  Object.assign(order.courier, { name: "Steadfast", trackingId: "SF123456" });
  const bn = customerMessage(order, shop, "bn");
  assert.match(bn, /Steadfast-এর মাধ্যমে পাঠানো হয়েছে/);
  assert.match(bn, /ট্র্যাকিং নম্বর: SF123456/);
  assert.match(customerChatLink(order, shop, "bn"), /^https:\/\/wa\.me\/8801711000000\?text=/);
});

test("courier sheet and summary", () => {
  const { shop, shirt } = shopWithStock();
  const order = newOrder(shop, { customer: { name: "Rahim", phone: "+8801711000000", address: "House 5", district: "Sylhet", area: "Zindabazar" } });
  order.items.push(itemFor(shirt, shirt.variants[0], 2));
  const [row] = courierRows([order]);
  assert.equal(row["Recipient Phone"], "01711000000");
  assert.equal(row["COD Amount"], 3430);
  assert.equal(row["Recipient Address"], "House 5, Zindabazar");
  assert.equal(row["Item Description"], "Linen Shirt (Navy / M) x2");
  order.status = "shipped";
  assert.deepEqual(summary([order], 0), { today: 1, toConfirm: 0, toShip: 0, withCourier: 1, codPending: 3430 });
});
