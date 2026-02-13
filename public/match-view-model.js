export function formatHandTotalLine(hand) {
  if (hand.totalKnown) return `Total: ${hand.total}`;
  if (typeof hand.visibleTotal === 'number') return `Showing: ${hand.visibleTotal}`;
  return 'Total: ?';
}
