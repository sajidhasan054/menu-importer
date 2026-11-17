// Shop orders and delivery anywhere in Bangladesh. Pure functions shared by
// the browser and the Node tests.
//
// Naming: order numbers are <shop prefix>-ORD-<number from 1001>, e.g. DFH-ORD-1001.

import { formatPrice } from "./catalog.js";
import { parseAmount } from "./parser.js";

export const DISTRICTS = {
  Dhaka: ["Dhaka", "Faridpur", "Gazipur", "Gopalganj", "Kishoreganj", "Madaripur", "Manikganj", "Munshiganj", "Narayanganj", "Narsingdi", "Rajbari", "Shariatpur", "Tangail"],
  Chattogram: ["Bandarban", "Brahmanbaria", "Chandpur", "Chattogram", "Cox's Bazar", "Cumilla", "Feni", "Khagrachhari", "Lakshmipur", "Noakhali", "Rangamati"],
  Rajshahi: ["Bogura", "Chapainawabganj", "Joypurhat", "Naogaon", "Natore", "Pabna", "Rajshahi", "Sirajganj"],
  Khulna: ["Bagerhat", "Chuadanga", "Jashore", "Jhenaidah", "Khulna", "Kushtia", "Magura", "Meherpur", "Narail", "Satkhira"],
  Barishal: ["Barguna", "Barishal", "Bhola", "Jhalokati", "Patuakhali", "Pirojpur"],
  Sylhet: ["Habiganj", "Moulvibazar", "Sunamganj", "Sylhet"],
  Rangpur: ["Dinajpur", "Gaibandha", "Kurigram", "Lalmonirhat", "Nilphamari", "Panchagarh", "Rangpur", "Thakurgaon"],
  Mymensingh: ["Jamalpur", "Mymensingh", "Netrokona", "Sherpur"],
};
export const ALL_DISTRICTS = Object.values(DISTRICTS).flat().sort();

export const COURIERS = ["Steadfast", "Pathao", "RedX", "Paperfly", "eCourier", "Sundarban Courier", "SA Paribahan", "Own delivery", "Other"];

export const PAYMENT_METHODS = [
  ["cod", "Cash on delivery"], ["bkash", "bKash"], ["nagad", "Nagad"], ["rocket", "Rocket"], ["bank", "Bank transfer"], ["card", "Card"],
];

export const STATUSES = [
  ["new", "New"], ["confirmed", "Confirmed"], ["packed", "Packed"], ["shipped", "With courier"],
  ["delivered", "Delivered"], ["returned", "Returned"], ["cancelled", "Cancelled"],
];
const NEXT = { new: "confirmed", confirmed: "packed", packed: "shipped", shipped: "delivered" };
export const nextStatus = status => NEXT[status] || null;
export const statusLabel = status => (STATUSES.find(([s]) => s === status) || [status, status])[1];
export const isOpen = status => !["delivered", "returned", "cancelled"].includes(status);

/** Statuses an order can move to from its current one. */
export function allowedStatuses(status) {
  const next = NEXT[status];
  const options = next ? [next] : [];
  if (isOpen(status)) options.push("cancelled");
  if (status === "shipped") options.push("returned");
  return options;
}

export function defaultDelivery() {
  return { insideDhaka: 70, outsideDhaka: 130 };
}

/** Delivery charge for a district using the shop's two rates. */
export function deliveryCharge(shop, district) {
  const rates = { ...defaultDelivery(), ...(shop.delivery || {}) };
  if (!district) return Number(rates.outsideDhaka) || 0;
  return Number(district === "Dhaka" ? rates.insideDhaka : rates.outsideDhaka) || 0;
}

/** Bangladesh mobile number in international form (8801XXXXXXXXX), or "" when it doesn't look like one. */
export function normalizePhone(value) {
  let digits = String(value ?? "").replace(/[০-৯]/g, d => String(d.charCodeAt(0) - 0x09e6)).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^01\d{9}$/.test(digits)) digits = "88" + digits;
  if (/^1\d{9}$/.test(digits)) digits = "880" + digits;
  return /^8801[3-9]\d{8}$/.test(digits) ? digits : "";
}

/** Local form for couriers and printing: 01XXXXXXXXX. */
export const localPhone = value => {
  const phone = normalizePhone(value);
  return phone ? "0" + phone.slice(3) : String(value ?? "").trim();
};

export function nextOrderNumber(shop) {
  const n = Math.max(1000, shop.lastOrder || 1000, ...(shop.orders || []).map(o => Number(String(o.number).split("-").pop()) || 0)) + 1;
  shop.lastOrder = n;
  return `${shop.code}-ORD-${n}`;
}

export function newOrder(shop, fields = {}) {
  const district = fields.customer?.district || "";
  return {
    id: `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    number: nextOrderNumber(shop),
    created: Date.now(),
    status: "new",
    customer: { name: "", phone: "", address: "", district, area: "" },
    items: [],
    deliveryCharge: deliveryCharge(shop, district),
    discount: 0,
    payment: { method: "cod", advance: 0, transactionId: "" },
    courier: { name: "", trackingId: "", trackingUrl: "", charge: "" },
    note: "",
    history: [{ status: "new", at: Date.now() }],
    stockTaken: false,
    ...fields,
  };
}

const money = value => Number(parseAmount(value) ?? 0) || 0;

export function orderTotals(order) {
  const subtotal = order.items.reduce((n, item) => n + money(item.price) * (Number(item.qty) || 0), 0);
  const total = Math.max(0, subtotal + money(order.deliveryCharge) - money(order.discount));
  const advance = Math.min(total, money(order.payment?.advance));
  // Cash on delivery collects what was not paid in advance; prepaid orders collect nothing.
  const collect = order.payment?.method === "cod" ? total - advance : Math.max(0, total - (advance || total));
  return { subtotal, total, advance, collect };
}

/** A line item for a product, or for one of its variants. */
export function itemFor(product, variant = null, qty = 1) {
  return {
    productId: product.id,
    sku: variant ? variant.sku : product.sku,
    title: product.title,
    option: variant ? [variant.color, variant.size].filter(Boolean).join(" / ") : "",
    price: parseAmount(variant?.price) ?? parseAmount(product.salePrice) ?? parseAmount(product.price) ?? 0,
    qty,
  };
}

/**
 * Take stock when an order is confirmed, and put it back when a confirmed
 * order is cancelled or returned. Products without a stock number are skipped.
 */
export function applyStock(order, products, newStatus) {
  const take = !order.stockTaken && ["confirmed", "packed", "shipped", "delivered"].includes(newStatus);
  const give = order.stockTaken && ["cancelled", "returned"].includes(newStatus);
  if (!take && !give) return [];
  const changed = [];
  for (const item of order.items) {
    const product = products.find(p => p.id === item.productId);
    if (!product) continue;
    const target = product.variants.find(v => v.sku === item.sku) || (product.sku === item.sku ? product : null);
    if (!target || target.quantity === "" || target.quantity === undefined) continue;
    const delta = (Number(item.qty) || 0) * (take ? -1 : 1);
    target.quantity = String(Math.max(0, (Number(target.quantity) || 0) + delta));
    changed.push(product);
  }
  order.stockTaken = take;
  return changed;
}

export function setStatus(order, status, products = []) {
  const changed = applyStock(order, products, status);
  order.status = status;
  order.history.push({ status, at: Date.now() });
  return changed;
}

// ------------------------------------------------------------------ messages

const taka = (amount, currency) => (currency === "BDT" ? `৳${Number(amount).toLocaleString("en-IN")}` : formatPrice(amount, currency));

const TEMPLATES = {
  en: {
    confirmed: o => [`Hi ${o.name}, your order ${o.number} is confirmed ✅`, "", o.items, "", `Delivery: ${o.delivery}`, `Total: ${o.total}`,
      o.collect ? `To pay on delivery: ${o.collect}` : "Paid in full, thank you!", "", `Thank you for shopping with ${o.shop}!`],
    packed: o => [`Hi ${o.name}, your order ${o.number} is packed and will be handed to the courier soon 📦`],
    shipped: o => [`Hi ${o.name}, your order ${o.number} is on its way with ${o.courier} 🚚`, o.tracking && `Tracking number: ${o.tracking}`, o.link,
      o.collect ? `Please keep ${o.collect} ready for the delivery person.` : ""],
    delivered: o => [`Hi ${o.name}, your order ${o.number} has been delivered. Thank you for shopping with ${o.shop}! 🙏`],
    cancelled: o => [`Hi ${o.name}, your order ${o.number} has been cancelled. Please message us if you have any questions.`],
    returned: o => [`Hi ${o.name}, your order ${o.number} came back to us. Please message us to arrange delivery again.`],
    new: o => [`Hi ${o.name}, we received your order ${o.number}:`, "", o.items, "", `Total: ${o.total}`, "We'll confirm it shortly."],
  },
  bn: {
    confirmed: o => [`প্রিয় ${o.name}, আপনার অর্ডার ${o.number} কনফার্ম হয়েছে ✅`, "", o.items, "", `ডেলিভারি চার্জ: ${o.delivery}`, `মোট: ${o.total}`,
      o.collect ? `ডেলিভারির সময় পরিশোধ করবেন: ${o.collect}` : "সম্পূর্ণ মূল্য পরিশোধ হয়েছে, ধন্যবাদ!", "", `${o.shop} থেকে কেনাকাটার জন্য ধন্যবাদ!`],
    packed: o => [`প্রিয় ${o.name}, আপনার অর্ডার ${o.number} প্যাক করা হয়েছে, শিগগিরই কুরিয়ারে পাঠানো হবে 📦`],
    shipped: o => [`প্রিয় ${o.name}, আপনার অর্ডার ${o.number} ${o.courier}-এর মাধ্যমে পাঠানো হয়েছে 🚚`, o.tracking && `ট্র্যাকিং নম্বর: ${o.tracking}`, o.link,
      o.collect ? `ডেলিভারির সময় ${o.collect} প্রস্তুত রাখুন।` : ""],
    delivered: o => [`প্রিয় ${o.name}, আপনার অর্ডার ${o.number} ডেলিভারি হয়েছে। ${o.shop} থেকে কেনাকাটার জন্য ধন্যবাদ! 🙏`],
    cancelled: o => [`প্রিয় ${o.name}, আপনার অর্ডার ${o.number} বাতিল করা হয়েছে। কোনো প্রশ্ন থাকলে আমাদের মেসেজ করুন।`],
    returned: o => [`প্রিয় ${o.name}, আপনার অর্ডার ${o.number} আমাদের কাছে ফেরত এসেছে। আবার ডেলিভারির জন্য আমাদের মেসেজ করুন।`],
    new: o => [`প্রিয় ${o.name}, আপনার অর্ডার ${o.number} আমরা পেয়েছি:`, "", o.items, "", `মোট: ${o.total}`, "শিগগিরই কনফার্ম করা হবে।"],
  },
};

/** The customer message for the order's current status, in English ("en") or Bangla ("bn"). */
export function customerMessage(order, shop, language = "en") {
  const { total, collect } = orderTotals(order);
  const currency = shop.currency;
  const values = {
    name: order.customer.name.trim() || (language === "bn" ? "গ্রাহক" : "there"),
    number: order.number,
    shop: shop.name,
    items: order.items.map(i => `• ${i.title}${i.option ? ` (${i.option})` : ""} × ${i.qty} — ${taka(money(i.price) * i.qty, currency)}`).join("\n"),
    delivery: taka(money(order.deliveryCharge), currency),
    total: taka(total, currency),
    collect: collect ? taka(collect, currency) : "",
    courier: order.courier.name || (language === "bn" ? "কুরিয়ার" : "our courier"),
    tracking: order.courier.trackingId,
    link: order.courier.trackingUrl,
  };
  const template = (TEMPLATES[language] || TEMPLATES.en)[order.status] || TEMPLATES.en.new;
  return template(values).filter(line => line !== false && line !== undefined && line !== null)
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function customerChatLink(order, shop, language) {
  const phone = normalizePhone(order.customer.phone);
  if (!phone) return "";
  return `https://wa.me/${phone}?text=${encodeURIComponent(customerMessage(order, shop, language))}`;
}

// ------------------------------------------------------------------ courier and reports

export const COURIER_COLUMNS = ["Invoice", "Recipient Name", "Recipient Phone", "Recipient Address", "District", "Area",
  "COD Amount", "Item Description", "Quantity", "Weight (kg)", "Note"];

/** Rows for bulk upload to a courier's merchant panel (rename columns to match its template if needed). */
export function courierRows(orders) {
  return orders.map(order => {
    const { collect } = orderTotals(order);
    return {
      Invoice: order.number,
      "Recipient Name": order.customer.name,
      "Recipient Phone": localPhone(order.customer.phone),
      "Recipient Address": [order.customer.address, order.customer.area].filter(Boolean).join(", "),
      District: order.customer.district,
      Area: order.customer.area,
      "COD Amount": collect,
      "Item Description": order.items.map(i => `${i.title}${i.option ? ` (${i.option})` : ""} x${i.qty}`).join(", "),
      Quantity: order.items.reduce((n, i) => n + (Number(i.qty) || 0), 0),
      "Weight (kg)": "",
      Note: order.note,
    };
  });
}

export function orderIssues(order) {
  const issues = [];
  if (!order.customer.name.trim()) issues.push("Add the customer's name");
  if (!normalizePhone(order.customer.phone)) issues.push("Add a valid Bangladesh mobile number (01XXXXXXXXX)");
  if (!order.customer.address.trim()) issues.push("Add the delivery address");
  if (!order.customer.district) issues.push("Choose the district");
  if (!order.items.length) issues.push("Add at least one product");
  return issues;
}

export function summary(orders, since = 0) {
  const open = orders.filter(o => isOpen(o.status));
  return {
    today: orders.filter(o => o.created >= since).length,
    toConfirm: orders.filter(o => o.status === "new").length,
    toShip: orders.filter(o => ["confirmed", "packed"].includes(o.status)).length,
    withCourier: orders.filter(o => o.status === "shipped").length,
    codPending: open.filter(o => o.status === "shipped").reduce((n, o) => n + orderTotals(o).collect, 0),
  };
}
