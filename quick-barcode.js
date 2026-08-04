const MAX_LABELS = 30;
const form = document.querySelector("#quickBarcodeForm");
const nameInput = document.querySelector("#productName");
const quantityInput = document.querySelector("#labelQuantity");
const message = document.querySelector("#message");
const preview = document.querySelector("#previewPanel");
const labelSheet = document.querySelector("#labelSheet");
let names = [];

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  const quantity = clampQuantity(quantityInput.value);
  if (!name) return;
  const available = MAX_LABELS - names.length;
  if (available === 0) return setMessage("The A4 sheet is full. Clear it before adding more labels.", true);
  if (quantity > available) {
    quantityInput.value = available;
    return setMessage(`Only ${available} label${available === 1 ? "" : "s"} remain on this sheet.`, true);
  }
  names.push(...Array.from({ length: quantity }, () => name));
  nameInput.value = "";
  quantityInput.value = "1";
  render();
  nameInput.focus();
});

quantityInput.addEventListener("input", () => {
  quantityInput.value = clampQuantity(quantityInput.value);
});
document.querySelector("#decreaseQuantity").addEventListener("click", () => {
  quantityInput.value = clampQuantity(Number(quantityInput.value) - 1);
});
document.querySelector("#increaseQuantity").addEventListener("click", () => {
  quantityInput.value = clampQuantity(Number(quantityInput.value) + 1);
});
document.querySelector("#fillThirtyButton").addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return setMessage("Enter a product name before using Fill 30.", true);
  }
  const available = MAX_LABELS - names.length;
  if (!available) return setMessage("The 3 × 10 sheet is already full.", true);
  names.push(...Array.from({ length: available }, () => name));
  nameInput.value = "";
  quantityInput.value = "1";
  render();
  nameInput.focus();
});
document.querySelector("#printButton").addEventListener("click", () => {
  if (names.length) window.print();
});
document.querySelector("#clearButton").addEventListener("click", () => {
  names = [];
  render();
  nameInput.focus();
});

function render() {
  labelSheet.replaceChildren(
    ...Array.from({ length: MAX_LABELS }, (_, index) => {
      const slot = document.createElement("article");
      slot.className = "label-slot";
      const name = names[index];
      if (name) {
        const logo = document.createElement("img");
        logo.className = "label-logo";
        logo.src = "ncf-logo-no-barcode.png";
        logo.alt = "";
        const text = document.createElement("strong");
        text.textContent = name;
        slot.append(logo, text);
      }
      return slot;
    }),
  );
  preview.hidden = names.length === 0;
  setMessage(`${names.length} of ${MAX_LABELS} labels ready. No barcode or price is included.`);
}

function clampQuantity(value) {
  return Math.min(MAX_LABELS, Math.max(1, Number.parseInt(value, 10) || 1));
}

function setMessage(text, error = false) {
  message.textContent = text;
  message.classList.toggle("error", error);
}
