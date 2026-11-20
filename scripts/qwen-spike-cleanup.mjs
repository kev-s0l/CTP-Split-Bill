// Convert a number to cents (integer)
const cents = (v) => {
      if (v === null || v === undefined || v === "") {
    return null;
  }

  const number = Number(v);

  if (!Number.isFinite(number)) {
    return null;
  }

  return Math.round(number * 100);
};

// Remove items with a $0.00 line total
function removeZeroPricedItems(items) {
  return items.filter((item) => cents(item.totalPrice) !== 0);
}
// Recalculate unit price if quantity > 1
function fixUnitPrices(items) {
  return items.map((item) => {
    const quantity = Number(item.quantity);
    const lineTotal = cents(item.totalPrice);

    if (
      !Number.isInteger(quantity) ||
      quantity <= 1 ||
      lineTotal === null
    ) {
      return item;
    }

    const unitPrice = lineTotal / quantity;

    return {
      ...item,
      unitPrice: (unitPrice / 100).toFixed(2),
    };
  });
}

// Validate receipt totals
function checkReceiptTotals(receipt) {
  const subtotal = cents(receipt.subtotal);
  const tax = cents(receipt.tax);
  const tip = cents(receipt.tip);
  const total = cents(receipt.total);

  if (
    subtotal === null ||
    tax === null ||
    tip === null ||
    total === null
  ) {
    return {
      valid: null,
      message: "Cannot verify: one or more totals are missing.",
    };
  }

  const calculatedTotal = subtotal + tax + tip;

  return {
    valid: calculatedTotal === total,
    calculatedTotal: (calculatedTotal / 100).toFixed(2),
    printedTotal: receipt.total,
    difference: ((total - calculatedTotal) / 100).toFixed(2),
  };
}

export {cents, removeZeroPricedItems, fixUnitPrices, checkReceiptTotals };