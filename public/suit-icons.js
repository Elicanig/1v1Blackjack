const SUIT_PATHS = {
  H: `
    <path d="M50 88C46.8 85.1 12 59.6 12 33.6C12 20.6 21.8 11 34 11C40.3 11 46.1 13.6 50 18.1C53.9 13.6 59.7 11 66 11C78.2 11 88 20.6 88 33.6C88 59.6 53.2 85.1 50 88Z"/>
  `,
  D: `
    <path d="M50 8L84 50L50 92L16 50Z"/>
  `,
  C: `
    <circle cx="50" cy="28.5" r="16.5"/>
    <circle cx="31" cy="53" r="16.5"/>
    <circle cx="69" cy="53" r="16.5"/>
    <path d="M44 57.5C44 64.4 42.5 71.5 36.6 80H63.4C57.5 71.5 56 64.4 56 57.5H44Z"/>
    <rect x="39" y="80" width="22" height="11" rx="5.5" ry="5.5"/>
  `,
  S: `
    <path d="M50 11C45.2 19.2 37.9 27.3 30.7 33.7C23.9 39.8 17 45.9 17 56.4C17 67 25.6 75.5 36.2 75.5C42.1 75.5 47.3 72.9 50 68.8C52.7 72.9 57.9 75.5 63.8 75.5C74.4 75.5 83 67 83 56.4C83 45.9 76.1 39.8 69.3 33.7C62.1 27.3 54.8 19.2 50 11Z"/>
    <path d="M44.5 73.5C44.5 79.5 43.2 85.2 38.8 92H61.2C56.8 85.2 55.5 79.5 55.5 73.5H44.5Z"/>
  `
};

export function renderSuitIconSvg(suit, className = '') {
  const iconClass = className ? `suit-icon ${className}` : 'suit-icon';
  const key = SUIT_PATHS[suit] ? suit : 'S';
  return `
    <svg class="${iconClass}" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      ${SUIT_PATHS[key]}
    </svg>
  `;
}
