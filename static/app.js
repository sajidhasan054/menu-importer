const byId = id => document.getElementById(id);
const upload = byId("upload");
const draft = byId("draft");
const reviewStatus = byId("review-status");
const items = byId("items");
let menu;

async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) {
    const message = Array.isArray(body.detail)
      ? body.detail.map(error => error.loc.slice(1).join(".") + " · " + error.msg).join("\n")
      : body.detail;
    throw new Error(message || "The request failed.");
  }
  return body;
}

function sync() {
  draft.value = JSON.stringify(menu, null, 2);
}

function field(container, target, key, label, choices) {
  const wrapper = document.createElement("label");
  wrapper.append(label);
  const input = document.createElement(choices ? "select" : "input");
  for (const choice of choices || []) input.add(new Option(choice, choice));
  input.value = target[key] ?? "";
  input.addEventListener("input", () => {
    target[key] = input.value.trim() || null;
    if (key === "currency") target[key] = input.value.trim().toUpperCase() || menu.default_currency;
    if (key === "price_amount" && input.value.trim() && ["unknown", "market"].includes(target.price_type)) {
      target.price_type = "fixed";
      input.closest(".fields").querySelector("select").value = "fixed";
    }
    sync();
  });
  wrapper.append(input);
  container.append(wrapper);
}

function button(container, text, action) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "secondary";
  control.textContent = text;
  control.onclick = action;
  container.append(control);
}

function fieldGroup(parent) {
  const group = document.createElement("div");
  group.className = "fields";
  parent.append(group);
  return group;
}

function emptyVariant() {
  return {currency: menu.default_currency, price_type: "unknown"};
}

function render() {
  items.replaceChildren();
  for (const [itemIndex, item] of menu.items.entries()) {
    const card = document.createElement("article");
    const fields = fieldGroup(card);
    field(fields, item, "name", "Item");
    field(fields, item, "name_en", "English name");
    field(fields, item, "section", "Section");
    field(fields, item, "description", "Description");
    for (const [index, variant] of item.variants.entries()) {
      const row = document.createElement("div");
      row.className = "variant";
      const group = fieldGroup(row);
      field(group, variant, "label", "Portion");
      field(group, variant, "price_amount", "Price");
      field(group, variant, "currency", "Currency");
      field(group, variant, "price_type", "Price type", ["unknown", "fixed", "from", "market"]);
      field(group, variant, "pieces", "Pieces");
      field(group, variant, "weight_g", "Weight (g)");
      if (item.variants.length > 1) {
        button(row, "Remove portion", () => { item.variants.splice(index, 1); render(); });
      }
      card.append(row);
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    button(actions, "Add portion", () => { item.variants.push(emptyVariant()); render(); });
    button(actions, "Remove item", () => { menu.items.splice(itemIndex, 1); render(); });
    card.append(actions);
    if (item.sources?.length) {
      const source = document.createElement("p");
      source.className = "help";
      source.textContent = item.sources.map(entry => entry.locator + " · " + entry.raw_text).join("\n");
      card.append(source);
    }
    items.append(card);
  }
  sync();
}

upload.onsubmit = async event => {
  event.preventDefault();
  const submit = upload.querySelector("button");
  submit.disabled = true;
  byId("status").textContent = "Reading menu files… Photos and PDFs can take up to a minute per page.";
  try {
    const result = await request("/api/import", {method:"POST", body:new FormData(upload)});
    menu = result.draft;
    const issues = byId("issues");
    issues.hidden = !result.review_issues.length;
    issues.querySelector("summary").textContent = result.review_issues.length + " entries to check";
    issues.querySelector("ul").replaceChildren(...result.review_issues.map(issue => {
      const row = document.createElement("li");
      row.textContent = issue.locator + " · " + issue.raw_text;
      return row;
    }));
    byId("review").hidden = false;
    byId("published").hidden = true;
    reviewStatus.textContent = "";
    issues.open = result.review_issues.length > 0 && menu.items.length === 0;
    const via = result.methods.includes("ai") ? " with AI vision" : "";
    byId("status").textContent = menu.items.length
      ? menu.items.length + " items extracted" + via + ". Check each portion and price, then download the CSV."
      : "No items could be extracted. Review the text below or try a clearer menu image.";
    render();
  } catch (error) {
    byId("status").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
};

fetch("/api/status").then(response => response.json()).then(status => {
  byId("ai-status").textContent = status.ai_enabled
    ? "AI reading is on: menus in any language and layout are supported."
    : "AI reading is off. Set ANTHROPIC_API_KEY to read photos, designed menus and other languages accurately. Clean CSV and Excel files work without it.";
}).catch(() => {});

byId("add").onclick = () => { menu.items.push({name:"", variants:[emptyVariant()]}); render(); };
byId("apply").onclick = async () => {
  try {
    const edited = await request("/api/validate", {method:"POST", headers:{"Content-Type":"application/json"}, body:draft.value});
    menu = edited;
    render();
    reviewStatus.textContent = "JSON changes applied.";
  } catch (error) {
    reviewStatus.textContent = error.message;
  }
};
byId("publish").onclick = async () => {
  const control = byId("publish");
  control.disabled = true;
  try {
    const result = await request("/api/menus", {method:"POST", headers:{"Content-Type":"application/json"}, body:draft.value});
    const link = byId("published");
    link.href = "/api/menus/" + result.id;
    link.hidden = false;
    reviewStatus.textContent = "Menu published.";
  } catch (error) {
    reviewStatus.textContent = error.message;
  } finally {
    control.disabled = false;
  }
};
function saveDownload(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

byId("download-csv").onclick = async () => {
  const control = byId("download-csv");
  control.disabled = true;
  try {
    const response = await fetch("/api/export/csv", {
      method: "POST", headers: {"Content-Type": "application/json"}, body: draft.value,
    });
    if (!response.ok) {
      const {detail} = await response.json();
      const message = Array.isArray(detail) ? detail.map(error => error.msg).join(" ") : detail;
      throw new Error(message || "CSV export failed.");
    }
    saveDownload(await response.blob(), "extracted-menu.csv");
    reviewStatus.textContent = "CSV downloaded.";
  } catch (error) {
    reviewStatus.textContent = error.message;
  } finally {
    control.disabled = false;
  }
};

byId("download").onclick = () => {
  saveDownload(new Blob([draft.value], {type:"application/json"}), "menu.json");
};
